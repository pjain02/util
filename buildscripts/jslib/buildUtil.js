var buildUtil = {};

buildUtil.getLineSeparator = function(){
	//summary: Gives the line separator for the platform.
	//For web builds override this function.
	return java.lang.System.getProperty("line.separator");
}

buildUtil.getDojoLoader = function(/*Object?*/dependencies){
	//summary: gets the type of Dojo loader for the build. For example default or
	//xdomain loading. Override for web builds.
	return (dependencies && dependencies["loader"] ? dependencies["loader"] : java.lang.System.getProperty("DOJO_LOADER"));
}

buildUtil.getDependencyList = function(/*Object*/dependencies, /*String or Array*/hostenvType, /*boolean?*/isWebBuild){
	if(!isWebBuild){
		djConfig = {
			baseRelativePath: "../"
			// isDebug: true
		};
	}

	if(!dependencies){
		dependencies = [ 
			"dojo.event.*",
			"dojo.io.*",
			"dojo.string",
			"dojo.xml.*",
			"dojo.xml.Parse",
			"dojo.widget.Parse",
			"dojo.widget.Button"
		];
	}
	
	var dojoLoader = buildUtil.getDojoLoader(dependencies);
	if(!dojoLoader || dojoLoader=="null" || dojoLoader==""){
		dojoLoader = "default";
	}

	if(!isWebBuild){
		dj_global = {};
		
		load("../src/bootstrap1.js");
		load("../src/loader.js");
		load("../src/hostenv_rhino.js");
	
		// FIXME: is this really what we want to say?
		dojo.render.html.capable = true;
	}

	dojo.hostenv.loadedUris.push("dojoGuardStart.js");
	dojo.hostenv.loadedUris.push("../src/bootstrap1.js");
	
	if(dojoLoader == "default"){
		dojo.hostenv.loadedUris.push("../src/loader.js");
	}else if(dojoLoader=="xdomain"){
		dojo.hostenv.loadedUris.push("../src/loader.js");
		dojo.hostenv.loadedUris.push("../src/loader_xd.js");
	}
	dojo.hostenv.loadedUris.push("dojoGuardEnd.js");
	
	if(!hostenvType){
		hostenvType = "browser";
	}
	
	if(hostenvType.constructor == Array){
		for(var x=0; x<hostenvType.length; x++){
			dojo.hostenv.loadedUris.push("../src/hostenv_"+hostenvType[x]+".js");
		}
		hostenvType = hostenvType.pop();
	}else{
		dojo.hostenv.loadedUris.push("../src/hostenv_"+hostenvType+".js");
	}
	
	if(dependencies["prefixes"]){
		var tmp = dependencies.prefixes;
		for(var x=0; x<tmp.length; x++){
			dojo.registerModulePath(tmp[x][0], tmp[x][1]);
		}
	}
	
	dojo.hostenv.name_ = hostenvType;
	
	//Override dojo.provide to get a list of resource providers.
	var currentProvideList = [];
	dojo._provide = dojo.provide;
	dojo.provide = function(resourceName){
		currentProvideList.push(resourceName);
		dojo._provide(resourceName);
	}
	
	function removeComments(contents){
		// if we get the contents of the file from Rhino, it might not be a JS
		// string, but rather a Java string, which will cause the replace() method
		// to bomb.
		contents = new String((!contents) ? "" : contents);
		// clobber all comments
		contents = contents.replace( /^(.*?)\/\/(.*)$/mg , "$1");
		contents = contents.replace( /(\n)/mg , "__DOJONEWLINE");
		contents = contents.replace( /\/\*(.*?)\*\//g , "");
		return contents.replace( /__DOJONEWLINE/mg , "\n");
	}
	
	// over-write dj_eval to prevent actual loading of subsequent files
	var old_eval = dj_eval;
	dj_eval = function(){ return true; }
	var old_load = load;
	load = function(uri){
		try{
			var text = removeComments((isWebBuild ? dojo.hostenv.getText(uri) : readText(uri)));
			var requires = dojo.hostenv.getRequiresAndProvides(text);
			eval(requires.join(";"));
			dojo.hostenv.loadedUris.push(uri);
			dojo.hostenv.loadedUris[uri] = true;
			var delayRequires = dojo.hostenv.getDelayRequiresAndProvides(text);
			eval(delayRequires.join(";"));
		}catch(e){
			if(isWebBuild){
				dojo.debug("error loading uri: " + uri + ", exception: " + e);
			}else{
				java.lang.System.err.println("error loading uri: " + uri + ", exception: " + e);
				quit(-1);
			}
		}
		return true;
	}
	
	if(isWebBuild){
		dojo.hostenv.oldLoadUri = dojo.hostenv.loadUri;
		dojo.hostenv.loadUri = load;
	}
	
	dojo.hostenv.getRequiresAndProvides = function(contents){
		// FIXME: should probably memoize this!
		if(!contents){ return []; }
	
		// check to see if we need to load anything else first. Ugg.
		var deps = [];
		var tmp;
		RegExp.lastIndex = 0;
		var testExp = /dojo.(hostenv.loadModule|hostenv.require|require|kwCompoundRequire|hostenv.conditionalLoadModule|hostenv.startPackage|provide)\([\w\W]*?\)/mg;
		while((tmp = testExp.exec(contents)) != null){
			deps.push(tmp[0]);
		}
		return deps;
	}
	
	dojo.hostenv.getDelayRequiresAndProvides = function(contents){
		// FIXME: should probably memoize this!
		if(!contents){ return []; }
	
		// check to see if we need to load anything else first. Ugg.
		var deps = [];
		var tmp;
		RegExp.lastIndex = 0;
		var testExp = /dojo.(requireAfterIf|requireIf)\([\w\W]*?\)/mg;
		while((tmp = testExp.exec(contents)) != null){
			deps.push(tmp[0]);
		}
		return deps;
	}

	if(dependencies["dojoLoaded"]){
		dependencies["dojoLoaded"]();
	}

	//Now build the URI list, starting with the main dojo.js file
	var result = [];
	result[0] = {
		layerName: "dojo.js",
		depList: buildUtil.determineUriList(dependencies, null, dependencies["filters"]),
		provideList: currentProvideList
	}
	currentProvideList = [];
	
	//Figure out if we have to process layers.
	var layerCount = 0;
	var layers = dependencies["layers"];
	if(layers && layers.length > 0){
		layerCount = layers.length;
	}
	
	//Process dojo layer files 
	if(layerCount){
		//Set up a lookup table for the layer URIs based on layer file name.
		var namedLayerUris = {"dojo.js": result[0].depList};
				
		for(var i = 0; i < layerCount; i++){
			var layer = layers[i];
			
			//Set up list of module URIs that are already defined for this layer's
			//layer dependencies.
			var layerUris = [];
			if(layer["layerDependencies"]){
				for(var j = 0; j < layer.layerDependencies.length; j++){
					if(namedLayerUris[layer.layerDependencies[j]]){
						layerUris.concat(namedLayerUris[layer.layerDependencies[j]]);
					}
				}
			}
			
			//Get the final list of dependencies in this layer
			var depList = buildUtil.determineUriList(layer.dependencies, layerUris, dependencies["filters"]); 
			
			//Store the layer URIs that are in this file as well as all files it depends on.
			namedLayerUris[layer.name] = layerUris.concat(depList);

			//Add to the results object.
			result[i + 1] = {
				layerName: layer.name,
				depList: depList,
				provideList: currentProvideList
			}

			//Reset for another run through the loop.
			currentProvideList = []; 
		} 
	}

	if(isWebBuild){
		dojo.hostenv.loadUri = dojo.hostenv.oldLoadUri;
	}else{
		load = old_load; // restore the original load function
		dj_eval = old_eval; // restore the original dj_eval function

		dj_global['dojo'] = undefined;
		dj_global['djConfig'] = undefined;
		delete dj_global;
	}

	return result; //Object with properties: name (String), depList (Array) and provideList (Array)
}

//Function to do the actual collection of file names to join.
buildUtil.determineUriList = function(/*Array*/dependencies, /*Array*/layerUris, /*Object*/filters){
	for(var x=0; x<dependencies.length; x++){
		try{
			var dep = dependencies[x];
			if(dep.indexOf("(") != -1){
				dep = dojo.hostenv.getDepsForEval(dep)[0];
			}
			//Don't process loader_xd.js since it has some regexps 
			//and mentions of dojo.require/provide, which will cause 
			//havoc in the dojo.hostenv.loadModule() method.
			if(dep.indexOf("loader_xd.js") == -1){
				dojo.hostenv.loadModule(dep, null, true);
			}
		}catch(e){
			java.lang.System.err.println("Error loading module!" + e);
			quit(-1);
		}
	}

	var depList = [];
	var seen = {};
	uris: for(var x=0; x<dojo.hostenv.loadedUris.length; x++){
		var curi = dojo.hostenv.loadedUris[x];
		if(!seen[curi]){
			seen[curi] = true;
			if(filters){
				for(var i in filters){
					if(curi.match(filters[i])){
						continue uris;
					}

					//If the uri is already accounted for in another
					//layer, skip it.
					if(layerUris){
						for(var i = 0; i < layerUris.length; i++){ 
							if(curi == layerUris[i]){ 
											continue uris; 
							} 
						} 
					} 
				}
			}
			depList.push(curi);
		}
	}
	
	//Clear out the loadedUris for the next run. 
	dojo.hostenv.loadedUris = []; 
	return depList; 
}


buildUtil.evalProfile = function(/*String*/ profileFile){
	var dependencies = null;
	var hostenvType = null;
	var profileText = new String(buildUtil.readFile(profileFile));
	
	//Remove the call to getDependencyList.js because we want to call it manually.
	profileText = profileText.replace(/load\(("|')getDependencyList.js("|')\)/, "");
	eval(profileText);
	return {
		dependencies: dependencies,
		hostenvType: hostenvType
	};
}

buildUtil.loadDependencyList = function(/*String*/profileFile){
	var profile = buildUtil.evalProfile(profileFile);
	if(profile.hostenvType){
		profile.hostenvType = profile.hostenvType.join(",\n");
	}
	var depResult = buildUtil.getDependencyList(profile.dependencies, profile.hostenvType);
	depResult.dependencies = profile.dependencies;
	
	return depResult;
}

buildUtil.createLayerContents = function(/*Array*/depList, /*Array*/provideList, /*String*/version){
	//summary: Creates the core contents for a build layer (including dojo.js).

	//Concat the files together, and mark where we should insert all the
	//provide statements.
	var dojoContents = "";
	for(var i = 0; i < depList.length; i++){
		//Make sure we have a JS string and not a Java string by using new String().
		dojoContents += new String(buildUtil.readFile(depList[i])) + "\r\n";
	}
	
	// dojo.requireLocalization is a special case as it pulls in dojo.i18n.loader at runtime
	if(dojoContents.match(buildUtil.globalRequireLocalizationRegExp)){
		depList.push("../src/i18n/loader.js");
		dojoContents += new String(readFile(depList[depList.length-1]));
	}

	//Construct a string of all the dojo.provide statements.
	//This string will be used to construct the regexp that will be
	//used to remove matching dojo.require statements.
	//Sort the provide list alphabetically to make it easy to read.
	//Order of provide statements do not matter.
	provideList = provideList.sort(); 
	var depRegExpString = "";
	for(var i = 0; i < provideList.length; i++){
		if(i != 0){
			depRegExpString += "|";
		}
		depRegExpString += '("' + provideList[i] + '")';
	}
		
	//If we have a string for a regexp, do the dojo.require() and requireIf() removal now.
	if(depRegExpString){
		var depRegExp = new RegExp("dojo\\.(require|requireIf)\\(.*?(" + depRegExpString + ")\\)(;?)", "g");
		dojoContents = dojoContents.replace(depRegExp, "");
	}

	//Set version number.
	//First, break apart the version string.
	var verSegments = version.split(".");
	var majorValue = 0;
	var minorValue = 0;
	var patchValue = 0;
	var flagValue = "";
	
	if(verSegments.length > 0 && verSegments[0]){
		majorValue = verSegments[0];
	}
	if(verSegments.length > 1 && verSegments[1]){
		minorValue = verSegments[1];
	}
	if(verSegments.length > 2 && verSegments[2]){
		//If the patchValue has a string in it, split
		//it off and store it in the flagValue.
		var patchSegments = verSegments[2].split(/\D/);
		patchValue = patchSegments[0];
		if(patchSegments.length > 1){
			flagValue = verSegments[2].substring(patchValue.length, verSegments[2].length);
		}
	}
	if(verSegments.length > 3 && verSegments[3]){
		flagValue = verSegments[3];
	}
	
	//Do the final version replacement.
	dojoContents = dojoContents.replace(
		/major:\s*\d*,\s*minor:\s*\d*,\s*patch:\s*\d*,\s*flag:\s*".*?"\s*,/g,
		"major: " + majorValue + ", minor: " + minorValue + ", patch: " + patchValue + ", flag: \"" + flagValue + "\","
	);
	
	return dojoContents;
}

buildUtil.makeDojoJs = function(/*Object*/dependencyResult, /*String*/version){
	//summary: Makes the uncompressed contents for dojo.js using the object
	//returned from buildUtil.getDependencyList()

	var lineSeparator = buildUtil.getLineSeparator();

	//Cycle through the layers to create the content for each layer.
	for(var i = 0; i< dependencyResult.length; i++){
		var layerResult = dependencyResult[i];
		layerResult.contents = buildUtil.createLayerContents(layerResult.depList, layerResult.provideList, version);
	}

	//Object with properties:
	//depList: Array of file paths (src/io/js)
	//provideList: Array of module resource names (dojo.io)
	//name: name of the layer file
	//contents: the file contents for that layer file.
	return dependencyResult; 

	//Return the dependency list, since it is used for other things in the ant file.
	return {
		resourceDependencies: depList,
		dojoContents: dojoContents
	};

	//Things to consider for later:

	//preload resources?
	//Remove requireLocalization calls?
	
	//compress (or minify?)
	//Name changes to dojo.js here
	
	//no compress if nostrip = true
	//Name changes to dojo.js here
	
	//Add build notice
	
	//Add copyright notice
	
	//Remove ${release_dir}/source.__package__.js
}


buildUtil.getDependencyPropertyFromProfile = function(/*String*/profileFile, /*String*/propName){
	//summary: Gets a dependencies property from the profile file. The value
	//of the property is assumed to be an array. An array will always be returned,
	//but it may be an empty array.

	//Use new String to make sure we have a JS string (not a Java string)
	//readText is from hostenv_rhino.js, so be sure to load Dojo before calling this function.
	var profileText = new String(readText(profileFile));
	//Get rid of CR and LFs since they seem to mess with the regexp match.
	//Using the "m" option on the regexp was not enough.
	profileText = profileText.replace(/\r/g, "");
	profileText = profileText.replace(/\n/g, "");


	var result = [];
	var matchRegExp = new RegExp("(dependencies\\." + propName + "\\s*=\\s*\\[[^;]*\\s*\\])", "m");

	var matches = profileText.match(matchRegExp);
	//Create a shell object to hold the evaled properties.
	var dependencies = {};
	
	if(matches && matches.length > 0){
		eval(matches[0]);
		if(dependencies && dependencies[propName] && dependencies[propName].length > 0){
			result = dependencies[propName];
		}
	}

	return result; //Array
}

buildUtil.configPrefixes = function(profileFile){
	//summary: Get the resource prefixes from the profile and registers the prefixes with Dojo.
	var prefixes = this.getDependencyPropertyFromProfile(profileFile, "prefixes");
	if(prefixes && prefixes.length > 0){
		for(i = 0; i < prefixes.length; i++){
			dojo.registerModulePath(prefixes[i][0], prefixes[i][1]);
		}
	}
	return prefixes; //Array of arrays
}

//The regular expressions that will help find dependencies in the file contents.
buildUtil.masterDependencyRegExpString = "dojo.(requireLocalization|require|requireIf|requireAll|provide|requireAfterIf|requireAfter|kwCompoundRequire|conditionalRequire|hostenv\\.conditionalLoadModule|.hostenv\\.loadModule|hostenv\\.moduleLoaded)\\(([\\w\\W]*?)\\)";
buildUtil.globalDependencyRegExp = new RegExp(buildUtil.masterDependencyRegExpString, "mg");
buildUtil.dependencyPartsRegExp = new RegExp(buildUtil.masterDependencyRegExpString);

buildUtil.masterRequireLocalizationRegExpString = "dojo.(requireLocalization)\\(([\\w\\W]*?)\\)";
buildUtil.globalRequireLocalizationRegExp = new RegExp(buildUtil.masterRequireLocalizationRegExpString, "mg");
buildUtil.requireLocalizationRegExp = new RegExp(buildUtil.masterRequireLocalizationRegExpString);

buildUtil.modifyRequireLocalization = function(fileContents, baseRelativePath, prefixes){
	//summary: Modifies any dojo.requireLocalization calls in the fileContents to have the
	//list of supported locales as part of the call. This allows the i18n loading functions
	//to only make request(s) for locales that actually exist on disk.
	var dependencies = [];
	
	//Make sure we have a JS string, and not a Java string.
	fileContents = String(fileContents);
	
	var modifiedContents = fileContents;
	
	if(fileContents.match(buildUtil.globalRequireLocalizationRegExp)){
		modifiedContents = fileContents.replace(buildUtil.globalRequireLocalizationRegExp, function(matchString){
			var replacement = matchString;
			var partMatches = matchString.match(buildUtil.requireLocalizationRegExp);
			var depCall = partMatches[1];
			var depArgs = partMatches[2];
	
			if(depCall == "requireLocalization"){
				//Need to find out what locales are available so the dojo loader
				//only has to do one script request for the closest matching locale.
				var reqArgs = buildUtil.getRequireLocalizationArgsFromString(depArgs);
				if(reqArgs.moduleName){
					//Find the list of locales supported by looking at the path names.
					var locales = buildUtil.getLocalesForBundle(reqArgs.moduleName, reqArgs.bundleName, baseRelativePath, prefixes);
	
					//Add the supported locales to the requireLocalization arguments.
					if(!reqArgs.localeName){
						depArgs += ", null";
					}
	
					depArgs += ', "' + locales.join(",") + '"';
					
					replacement = "dojo." + depCall + "(" + depArgs + ")";
				}
			}
			return replacement;		
		});
	}	
	return modifiedContents;
}

buildUtil.makeFlatBundleContents = function(prefix, prefixPath, srcFileName){
	//summary: Given a nls file name, flatten the bundles from parent locales into the nls bundle.
	var bundleParts = buildUtil.getBundlePartsFromFileName(prefix, prefixPath, srcFileName);
	if(!bundleParts){
		return null;
	}
	var moduleName = bundleParts.moduleName;
	var bundleName = bundleParts.bundleName;
	var localeName = bundleParts.localeName;

	//print("## moduleName: " + moduleName + ", bundleName: " + bundleName + ", localeName: " + localeName);
	dojo.requireLocalization(moduleName, bundleName, localeName);
	
	//Get the generated, flattened bundle.
	var module = dojo.getObject(moduleName);
	var bundleLocale = localeName ? localeName.replace(/-/g, "_") : "ROOT";
	var flattenedBundle = module.nls[bundleName][bundleLocale];
	//print("## flattenedBundle: " + flattenedBundle);
	if(!flattenedBundle){
		throw "Cannot create flattened bundle for src file: " + srcFileName;
	}

	return dojo.json.serialize(flattenedBundle);
}

//Given a module and bundle name, find all the supported locales.
buildUtil.getLocalesForBundle = function(moduleName, bundleName, baseRelativePath, prefixes){
	//Build a path to the bundle directory and ask for all files that match
	//the bundle name.
	var filePath = this.mapResourceToPath(moduleName, baseRelativePath, prefixes);
	
	var bundleRegExp = new RegExp("nls[/]?([\\w\\-]*)/" + bundleName + ".js$");
	var bundleFiles = buildUtil.getFilteredFileList(filePath + "nls/", bundleRegExp, true);
	
	//Find the list of locales supported by looking at the path names.
	var locales = [];
	for(var j = 0; j < bundleFiles.length; j++){
		var bundleParts = bundleFiles[j].match(bundleRegExp);
		if(bundleParts && bundleParts[1]){
			locales.push(bundleParts[1]);
		}else{
			locales.push("ROOT");
		}
	}

	return locales;
}

buildUtil.getRequireLocalizationArgsFromString = function(argString){
	//summary: Given a string of the arguments to a dojo.requireLocalization
	//call, separate the string into individual arguments.
	var argResult = {
		moduleName: null,
		bundleName: null,
		localeName: null
	};
	
	var l10nMatches = argString.split(/\,\s*/);
	if(l10nMatches && l10nMatches.length > 1){
		argResult.moduleName = l10nMatches[0] ? l10nMatches[0].replace(/\"/g, "") : null;
		argResult.bundleName = l10nMatches[1] ? l10nMatches[1].replace(/\"/g, "") : null;
		argResult.localeName = l10nMatches[2];
	}
	return argResult;
}

buildUtil.getBundlePartsFromFileName = function(prefix, prefixPath, srcFileName){
	//Pull off any ../ values from prefix path to make matching easier.
	var prefixPath = prefixPath.replace(/\.\.\//g, "");

	//Strip off the prefix path so we can find the real resource and bundle names.
	var prefixStartIndex = srcFileName.lastIndexOf(prefixPath);
	if(prefixStartIndex != -1){
		var startIndex = prefixStartIndex + prefixPath.length;
		
		//Need to add one if the prefiPath does not include an ending /. Otherwise,
		//We'll get extra dots in our bundleName.
		if(prefixPath.charAt(prefixPath.length) != "/"){
			startIndex += 1;
		}
		srcFileName = srcFileName.substring(startIndex, srcFileName.length);
	}
	
	//var srcIndex = srcFileName.indexOf("src/");
	//srcFileName = srcFileName.substring(srcIndex + 4, srcFileName.length);
	var parts = srcFileName.split("/");

	//Split up the srcFileName into arguments that can be used for dojo.requireLocalization()
	var moduleParts = [prefix];
	for(var i = 0; parts[i] != "nls"; i++){
		moduleParts.push(parts[i]);
	}
	var moduleName = moduleParts.join(".");
	if(parts[i+1].match(/\.js$/)){
		var localeName = "";
		var bundleName = parts[i+1];
	}else{
		var localeName = parts[i+1];
		var bundleName = parts[i+2];	
	}

	if(!bundleName || bundleName.indexOf(".js") == -1){
		//Not a valid bundle. Could be something like a README file.
		return null;
	}else{
		bundleName = bundleName.replace(/\.js/, "");
	}

	return {moduleName: moduleName, bundleName: bundleName, localeName: localeName};
}

buildUtil.mapResourceToPath = function(resourceName, baseRelativePath, prefixes){
	//summary: converts a resourceName to a path.
	//resourceName: String: like dojo.foo or mymodule.bar
	//baseRelativePath: String: the relative path to Dojo. All resource paths are relative to dojo.
	//                  it always ends in with a slash.
	//prefixes: Array: Actually an array of arrays. Comes from profile js file.
	//          dependencies.prefixes = [["mymodule.foo", "../mymoduledir"]];
	
	var bestPrefix = "";
	var bestPrefixPath = "";
	if(prefixes){
		for(var i = 0; i < prefixes.length; i++){
			//Prefix must match from the start of the resourceName string.
			if(resourceName.indexOf(prefixes[i][0]) == 0){
				if(prefixes[i][0].length > bestPrefix.length){
					bestPrefix = prefixes[i][0];
					bestPrefixPath = prefixes[i][1];
				}
			}
		}
	}

	if(bestPrefixPath == "" && resourceName.indexOf("dojo.") == 0){
		bestPrefix = "dojo";
		bestPrefixPath = "src/";
	}
	
	//Get rid of matching prefix from resource name.
	resourceName = resourceName.replace(bestPrefix, "");
	
	if(resourceName.charAt(0) == '.'){
		resourceName = resourceName.substring(1, resourceName.length);
	}
	
	resourceName = resourceName.replace(/\./g, "/");

	var finalPath = baseRelativePath + bestPrefixPath;
	if(finalPath.charAt(finalPath.length - 1) != "/"){
		finalPath += "/";
	}
	if (resourceName){
		finalPath += resourceName + "/";
	}
	
	return finalPath;
}


function makeResourceUri(resourceName, templatePath, srcRoot, prefixes){
	var bestPrefix = "";
	var bestPrefixPath = ""
	if(prefixes){
		for (var i = 0; i < prefixes.length; i++){
			var prefix = prefixes[i];
			//Prefix must match from the start of the resourceName string.
			if(resourceName.indexOf(prefix[0]) == 0){
				if(prefix[0].length > bestPrefix.length){
					bestPrefix = prefix[0];
					bestPrefixPath = prefix[1];
				}
			}
		}

		if(bestPrefixPath != ""){
			//Convert resourceName to a path
			resourceName = resourceName.replace(bestPrefix, "");
			if(resourceName.indexOf(".") == 0){
				resourceName = resourceName.substring(1, resourceName.length);
			}
			resourceName = resourceName.replace(/\./g, "/");

			//Final path construction
			var finalPath = srcRoot;
			finalPath += bestPrefixPath + "/";
			if(resourceName){
				finalPath += resourceName + "/";
			}
			finalPath += templatePath;

			return finalPath;
		}
	}

	return srcRoot + templatePath;
}

buildUtil.internTemplateStrings = function(profileFile, loader, releaseDir, srcRoot){
	loader = loader || "default";
	releaseDir = releaseDir || "../release/dojo";
	srcRoot = srcRoot || "../";
	
	print("loader: " + loader);
	print("releaseDir - " + releaseDir);

	//Load Dojo so we can use readText() defined in hostenv_rhino.js.
	//Also gives us the ability to use all the neato toolkit features.
	djConfig={
		baseRelativePath: "../"
	};
	load('../dojo.js');
	dojo.require("dojo.string.extras");
	dojo.require("dojo.i18n.common");
	dojo.require("dojo.json");
	
	//Find the bundles that need to be flattened.
	load("buildUtil.js");

	var profile = buildUtil.evalProfile(profileFile);
	var dependencies = profileFile.dependencies;

	var prefixes = dependencies["prefixes"] || [];
	//Make sure dojo is in the list.
	var dojoPath = releaseDir.replace(/^.*(\/|\\)release(\/|\\)/, "release/");
	prefixes.push(["dojo", dojoPath + "/src"]);

	var skiplist = dependencies["internSkipList"] || [];
	
	//Intern strings for dojo.js
	buildUtil.internTemplateStringsInFile(loader, releaseDir + "/dojo.js", srcRoot, prefixes, skiplist);
	buildUtil.internTemplateStringsInFile(loader, releaseDir + "/dojo.js.uncompressed.js", srcRoot, prefixes, skiplist);

	//Intern strings for any other layer files.
	if(dependencies["layers"] && dependencies.layers.length > 0){
		for(var i = 0; i < dependencies.layers.length; i++){
			buildUtil.internTemplateStringsInFile(loader, releaseDir + "/" + dependencies.layers[i].name, srcRoot, prefixes, skiplist);
		}
	}

	//Intern strings for all files in widget dir (xdomain and regular files)
	var fileList = buildUtil.getFilteredFileList(releaseDir + "/src/widget",
		/\.js$/, true);

	if(fileList){
		for(var i = 0; i < fileList.length; i++){
			buildUtil.internTemplateStringsInFile(loader, fileList[i], srcRoot, prefixes, skiplist)
		}
	}
}

buildUtil.internTemplateStringsInFile = function(loader, resourceFile, srcRoot, prefixes, skiplist){
	var resourceContent = new String(readText(resourceFile));
	resourceContent = buildUtil.interningRegexpMagic(loader, resourceContent, srcRoot, prefixes, skiplist);
	buildUtil.saveUtf8File(resourceFile, resourceContent);
}

buildUtil.interningDojoUriRegExpString = "(((templatePath|templateCssPath)\\s*(=|:)\\s*)|dojo\\.uri\\.cache\\.allow\\(\\s*)dojo\\.uri\\.(dojo|module)?Uri\\(\\s*?[\\\"\\']([\\w\\.\\/]+)[\\\"\\'](([\\,\\s]*)[\\\"\\']([\\w\\.\\/]*)[\\\"\\'])?\\s*\\)";
buildUtil.interningGlobalDojoUriRegExp = new RegExp(buildUtil.interningDojoUriRegExpString, "g");
buildUtil.interningLocalDojoUriRegExp = new RegExp(buildUtil.interningDojoUriRegExpString);

//WARNING: This function assumes dojo.string.escapeString() has been loaded.
buildUtil.interningRegexpMagic = function(loader, resourceContent, srcRoot, prefixes, skiplist, isSilent){
	return resourceContent.replace(buildUtil.interningGlobalDojoUriRegExp, function(matchString){
		var parts = matchString.match(buildUtil.interningLocalDojoUriRegExp);

		var filePath = "";
		var resourceNsName = "";
		if(parts[5] == "dojo"){
			if(parts[6].match(/(\.htm|\.html|\.css)$/)){
				if(!isSilent){
					print("Dojo match: " + parts[6]);
				}
				filePath = srcRoot + parts[6]
				resourceNsName = "dojo:" + parts[6];
			}
		}else{
			if(!isSilent){
				print("Module match: " + parts[6] + " and " + parts[9]);
			}
			filePath = makeResourceUri(parts[6], parts[9], srcRoot, prefixes);
			resourceNsName = parts[6] + ':' + parts[9];		
		}

		if(!filePath || buildUtil.isValueInArray(resourceNsName, skiplist)){
			if(filePath && !isSilent){
				print("Skip intern resource: " + filePath);
			}
		}else{
			if(!isSilent){
				print("Interning resource path: " + filePath);
			}
			//dojo.string.escapeString will add starting and ending double-quotes.
			var jsEscapedContent = dojo.string.escapeString(new String(readText(filePath)));
			if(jsEscapedContent){
				if(matchString.indexOf("dojo.uri.cache.allow") != -1){
					//Handle dojo.uri.cache-related interning.
					var parenIndex = matchString.lastIndexOf(")");
					matchString = matchString.substring(0, parenIndex + 1) + ", " + jsEscapedContent;
					matchString = matchString.replace("dojo.uri.cache.allow", "dojo.uri.cache.set");
				}else{
					//Handle templatePath/templateCssPath-related interning.
					if(parts[3] == "templatePath"){
						//Replace templatePaths
						matchString = "templateString" + parts[4] + jsEscapedContent;
					}else{
						//Dealing with templateCssPath
						//For the CSS we need to keep the template path in there
						//since the widget loading stuff uses the template path to
						//know whether the CSS has been processed yet.
						//Could have matched assignment via : or =. Need different statement separators at the end.
						var assignSeparator = parts[4];
						var statementSeparator = ",";
						var statementPrefix = "";
			
						//FIXME: this is a little weak because it assumes a "this" in front of the templateCssPath
						//when it is assigned using an "=", as in 'this.templateCssPath = dojo.uri.dojoUri("some/path/to/Css.css");'
						//In theory it could be something else, but in practice it is not, and it gets a little too weird
						//to figure out, at least for now.
						if(assignSeparator == "="){
							statementSeparator = ";";
							statementPrefix = "this.";
						}
						matchString = "templateCssString" + assignSeparator + jsEscapedContent + statementSeparator + statementPrefix + parts[0];
					}
				}
			}
		}

		return matchString;
	});
}

buildUtil.isValueInArray = function(value, ary){
	for(var i = 0; i < ary.length; i++){
		if(ary[i] == value){
			return true;
		}
	}
	return false;
}


//Recurses startDir and finds matches to the files that match regExpFilter.
//Ignores files/directories that start with a period (.).
buildUtil.getFilteredFileList = function(startDir, regExpFilter, makeUnixPaths, startDirIsJavaObject){
	var files = [];

	var topDir = startDir;
	if(!startDirIsJavaObject){
		topDir = new java.io.File(startDir);
	}

	if(topDir.exists()){
		var dirFileArray = topDir.listFiles();
		for (var i = 0; i < dirFileArray.length; i++){
			var file = dirFileArray[i];
			if(file.isFile()){
				var filePath = file.getPath();
				if(makeUnixPaths){
					//Make sure we have a JS string.
					filePath = String(filePath);
					if(filePath.indexOf("/") == -1){
						filePath = filePath.replace(/\\/g, "/");
					}
				}
				if(!file.getName().match(/^\./) && filePath.match(regExpFilter)){
					files.push(filePath);
				}
			}else if(file.isDirectory() && !file.getName().match(/^\./)){
				var dirFiles = this.getFilteredFileList(file, regExpFilter, makeUnixPaths, true);
				files.push.apply(files, dirFiles);
			}
		}
	}

	return files;
}

buildUtil.ensureEndSlash = function(path){
	if(path.charAt(path.length) != '/' || path.charAt(path.length) != '\\'){
		path += "/";
	}
	return path;
}

buildUtil.readFile = function(/*String*/path, /*String?*/encoding){
	encoding = encoding || "utf-8";
	var file = new java.io.File(path);
	var lineSeparator = buildUtil.getLineSeparator();
	var input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding));
	try {
		var stringBuffer = new java.lang.StringBuffer();
		var line = "";
		while((line = input.readLine()) !== null){
			stringBuffer.append(line);
			stringBuffer.append(lineSeparator);
		}
		return stringBuffer.toString();
	} finally {
		input.close();
	}
}

buildUtil.saveUtf8File = function(/*String*/fileName, /*String*/fileContents){
	buildUtil.saveFile(fileName, fileContents, "utf-8");
}

buildUtil.saveFile = function(/*String*/fileName, /*String*/fileContents, /*String?*/encoding){
	var outFile = new java.io.File(fileName);
	var outWriter;
	if(encoding){
		outWriter = new java.io.OutputStreamWriter(new java.io.FileOutputStream(outFile), encoding);
	}else{
		outWriter = new java.io.OutputStreamWriter(new java.io.FileOutputStream(outFile));
	}

	var os = new java.io.BufferedWriter(outWriter);
	try{
		os.write(fileContents);
	}finally{
		os.close();
	}
}

buildUtil.deleteFile = function(fileName){
	var file = new java.io.File(fileName);
	if(file.exists()){
		file["delete"]();
	}
}

buildUtil.optimizeJs = function(/*String fileName*/fileName, /*String*/fileContents, /*String*/copyright, /*boolean*/doCompression){
	//summary: either strips comments from string or compresses it.

	//Look for copyright. If so, maintain it.
	//If no copyright text passed in, assume want a really stripped
	//version.
	copyright = copyright || "";
	var copyrightText = "";
	if(copyright){
		var singleLineMatches = fileContents.match(/\/\/.*copyright.*$/gi);
		
		//Get rid of cr, lf, since it messes up matching.
		var copyrightFileContents = fileContents.replace(/\r/g, "__DOJOCARRIAGERETURN__").replace(/\n/g, "__DOJONEWLINE__");
		var multiLineMatches = copyrightFileContents.match(/\/\*.*?copyright.*?\*\//gi);
	
		//Finalize copyright notice.
		if((multiLineMatches && multiLineMatches.length > 0) || (singleLineMatches && singleLineMatches.length > 0)){
			if(multiLineMatches && multiLineMatches.length > 0){
				copyrightText += multiLineMatches.join("\r\n").replace(/__DOJOCARRIAGERETURN__/g, "\r").replace(/__DOJONEWLINE__/g, "\n");
			}					
			if(singleLineMatches && singleLineMatches.length > 0){
				copyrightText += singleLineMatches.join("\r\n");
			}
			copyrightText += buildUtil.getLineSeparator();
		}else{
			copyrightText = copyright;
		}
	}

	//Use rhino to help do minifying/compressing.
	var context = Packages.org.mozilla.javascript.Context.enter();
	try{
		// Use the interpreter for interactive input (copied this from Main rhino class).
		context.setOptimizationLevel(-1);
		
		var script = context.compileString(fileContents, fileName, 1, null);
		if(doCompression){
			//Apply compression using custom compression call in Dojo-modified rhino.
			fileContents = new String(context.compressScript(script, 0, fileContents, 1));
		}else{
			//Strip comments
			fileContents = new String(context.decompileScript(script, 0));
			//Replace the spaces with tabs.
			//Ideally do this in the pretty printer rhino code.
			fileContents = fileContents.replace(/    /g, "\t");

			//If this is an nls bundle, make sure it does not end in a ;
			//Otherwise, bad things happen.
			if(fileName.match(/\/nls\//)){
				fileContents = fileContents.replace(/;\s*$/, "");
			}
		}
	}finally{
		Packages.org.mozilla.javascript.Context.exit();
	}

	return copyrightText + fileContents;
}

buildUtil.stripComments = function(/*String*/startDir, /*boolean*/suppressDojoCopyright){
	//summary: strips the JS comments from all the files in "startDir", and all subdirectories.
	var copyright = suppressDojoCopyright ? "" : (new String(buildUtil.readFile("copyright.txt")) + buildUtil.getLineSeparator());
	var fileList = buildUtil.getFilteredFileList(startDir, /\.js$/, true);
	if(fileList){
		for(var i = 0; i < fileList.length; i++){
			//Don't process dojo.js since it has already been processed.
			//Don't process dojo.js.uncompressed.js because it is huge.
			//Don't process anything that might be in a buildscripts folder (only a concern for webbuild.sh)
			if(!fileList[i].match(/dojo\.js$/)
				&& !fileList[i].match(/dojo\.js\.uncompressed\.js$/)
				&& !fileList[i].match(/buildscripts/)
				&& !fileList[i].match(/tests\//)){
				print("Stripping comments from file: " + fileList[i]);
				
				//Read in the file. Make sure we have a JS string.
				var fileContents = new String(buildUtil.readFile(fileList[i]));

				//Do comment removal.
				try{
					fileContents = buildUtil.optimizeJs(fileList[i], fileContents, copyright, false);
				}catch(e){
					print("Could not strip comments for file: " + fileList[i] + ", error: " + e);
				}

				//Write out the file with appropriate copyright.
				buildUtil.saveUtf8File(fileList[i], fileContents);
			}
		}
	}
}

