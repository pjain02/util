define(["require", "./buildControlBase", "fs", "./fileUtils"], function(require, bc, fs, fileUtils) {
	eval(require.scopeify("fs, ./fileUtils"));
	var
		defaultBuildProps= {
			// v1.6- default values
			profile:"base",
			profileFile:"",
			htmlFiles:"",
			htmlDir:"",
			action:"help",
			version:"0.0.0.dev",
			localeList:"ar,ca,cs,da,de-de,el,en-gb,en-us,es-es,fi-fi,fr-fr,he-il,hu,it-it,ja-jp,ko-kr,nl-nl,nb,pl,pt-br,pt-pt,ru,sk,sl,sv,th,tr,zh-tw,zh-cn",
			releaseName:"dojo",
			releaseDir:"../../release/",
			internStrings:true,
			optimize:"",
			layerOptimize:"shrinksafe",
			cssOptimize:"",
			cssImportIgnore:"",
			stripConsole:1,
			copyTests:1,
			mini:true,
			xdDojoPath:"",
			symbol:"",
			scopeDjConfig:"",
			scopeMap:{},
			buildLayers:"",
			query:"default",
			replaceLoaderConfig:1,
	
			// the following configuration variables are deprecated and have no effect
			//log:0,
			//loader:0,
			//xdScopeArgs:0,
			//xdDojoScopeName:0,
			//expandProvide:0,
			//removeDefaultNameSpaces:0,
			//addGuards:0,

			// the following values are settings understood by the v1.7+ builder that cause behavior like the v1.6- builder

			// if we're building consequent to a profile, then don't include a default package
			noDefaultPackage:1,
			destPackageBasePath:".",

			packages:[],

			staticHasFeatures: {
				'dojo-boot':0/*, //**
				'dojo-debug-messages':0,
				'dojo-guarantee-console':0,
				'dojo-load-firebug-console':0,
				'dojo-loader':1,
				'dojo-register-openAjax':0,
				'dojo-sniff':1,
				'dojo-test-sniff':1,//**
				'dojo-test-xd':1,//**
				'dojo-v1x-i18n-Api':1,
				'dom':1,
				'host-browser':1,
				'host-node':0,
				'host-rhino':0,
				"loader-hasApi":1,
				'loader-catchApi':1,
				'loader-errorApi':1,
				'loader-hasCache':1,
				'loader-injectApi':1,
				'loader-pageLoadApi':1,
				'loader-priority-readyApi':1,
				'loader-provides-xhr':1,
				'loader-publish-privates':1, // TODO: change to 
				'loader-requirejsApi':0,
				'loader-sniff':0,
				'loader-timeoutApi':1,
				'loader-traceApi':1,//**
				'loader-undefApi':0,
				"loader-XhrApi":1,
				"loader-getTextApi":1*/
			},

			bootConfig: {
				packages: [{
					// note: like v1.6-, this bootstrap computes baseUrl to be the dojo directory
					name:'dojo',
					location:'.',
					lib:'.'
				}]
			},

			dojoLayer: {
				include:["dojo"],
				exclude:[]
			}
		},

		processProfile= function(profile) {
			// process a v1.6- profile
			//
			// The v1.6- has the following relative path behavior:
			//	
			//	 * the util/buildscripts directory is assumed to be the cwd upon build program startup
			//	 * the dojo directory as specified in profile dependencies.prefixes (if relative) is 
			//		 assumed to be relative to util/buildscripts
			//	 * similarly the releaseDir directory (if relative) is assumed to be relative to util/buildscripts
			//	 * all other relative paths are relative to the dojo directory (in spite of what some docs say)
			//	 * all non-specified paths for top-level modules are assummed to be siblings of dojo.
			//		 For example, myTopModule.mySubModule is assumed to reside at dojo/../myTopModule/mySubModule.js
			// 
			// This has the net effect of causing all relative paths to be relative to the current working directory
			// and further forcing the build program to be executed from util/buildscripts. Neither of these requirements
			// may be convenient. The behavior is probably consequent to rhino's *brain dead* design that does not
			// report the full path of the script being executed. In order to help, the following v1.7+ options are available:
			// 
			//	 -buildPath path/to/util/buildscripts/build
			//	 -baseUrl		path/to/use/instead/of/path/to/util/buildscripts
			// 
			// This doesn't eliminiate the strange behavior of releaseDir. Users who find releaseDir inconvenient should
			// use destBasePath.

			var
				p,
				result= {},
				layers= profile.layers || [],
				prefixes= profile.prefixes || [];

			for (p in defaultBuildProps) {
				result[p]= defaultBuildProps[p];
			}
		
			// find all the top-level modules by traversing each layer's dependencies
			var topLevelMids= {dojo:1};
			layers.forEach(function(layer){
				(layer.dependencies || []).forEach(function(mid) {
					// pair a [mid, path], mid, a dotted module id, path relative to dojo directory
					topLevelMids[mid.split(".")[0]]= 1;
				});
			});

			// convert the prefix vector to a map; make sure all the prefixes are in the top-level map
			var prefixMap= {};
			prefixes.forEach(function(pair){
				topLevelMids[pair[0]]= 1;
				prefixMap[pair[0]]= pair[1];
			});

			// make sure we have a dojo prefix; memorize it
			if(!prefixMap.dojo) {
				// best guess is relative cwd assumed to be util/buildscripts
				prefixMap.dojo= "../../dojo";
			}
			var dojoPath= prefixMap.dojo= compactPath(prefixMap.dojo);

			// make sure we have a prefix for each top-level module
			// normalize dojo out of the non-dojo prefixes
			for(var mid in topLevelMids){
				var path= prefixMap[mid] || ("../" + mid);
				if (mid!="dojo") {
					prefixMap[mid]= computePath(path, dojoPath);
				}
			}

			// now make a package for each top-level module
			var packages= result.packages= [];
			for(mid in prefixMap){
				packages.push({
					name:mid,
					location:prefixMap[mid],
					lib:"."
				});
			}

			// resolve all the layer names into module names;
			var 
				filenameToMid= function(filename) {
					for (topLevelMid in prefixMap) {
						if (filename.indexOf(prefixMap[topLevelMid])==0) {
							var 
								mid= filename.substring(prefixMap[topLevelMid].length),
								match= mid.match(/(.+)\.js$/);
							if (match) {
								return topLevelMid + match[1];
							}
						}
					}
					return 0;
				},
				layerNameToLayerMid= {};
			layers.forEach(function(layer) {
				var mid= filenameToMid(computePath(layer.name, dojoPath));
				if (!mid) {
					bc.logError("unable to resolve layer name (" + layer.name + ") into a module identifier");
					return;
				}
				layerNameToLayerMid[layer.name]= mid;
			});


			var fixedLayers= {};
			layers.forEach(function(layer) {
				var 
					mid= layerNameToLayerMid[layer.name],
					result= {
						include:(layer.dependencies || []).map(function(item) { return item.replace(/\./g, "/"); }),
						exclude:(layer.layerDependencies || []).map(function(item) { 
							var mid= layerNameToLayerMid[item];
							if (!mid) {
								bc.logError("unable to resolve layer dependency (" + item + ") in layer (" + layer.name + ")");
							}
							return mid;
						})
					};
				if (mid!="dojo") {
					result.exclude.push("dojo");
				}
				if (layer.discard) {
					result.discard= true;
				}
				if (layer.copyright) {
					result.copyright= layer.copyright;
				}
				fixedLayers[mid]= result;
			});
			result.layers= fixedLayers;

			if (typeof profile.basePath=="undefined") {
				profile.basePath= compactPath(catPath(require.baseUrl, "../util/buildscripts"));
			}

			if (profile.destBasePath) {
				if (profile.releaseDir || profile.releaseName) {
					bc.logWarn("destBasePath given; ignoring releaseDir and releaseName");
				}
			} else {
				var releaseName= profile.releaseName;
				if (releaseName) {
					releaseName= releaseName.match(/[^\/]+/)[0];
				}
				var releaseDir= (profile.releaseDir || result.releaseDir).replace(/\\/g, "/");
				
				profile.destBasePath= computePath(catPath(releaseDir, releaseName), profile.basePath);
			}

			for (p in profile) {
				// the conditional is to keep v1.6- compat
				// TODO: recognition of "false" should be deprecated
				if (/loader|xdScopeArgs|xdDojoScopeName|expandProvide|removeDefaultNameSpaces|addGuards/.test(p)) {
					profile[p]= "deprecated; value(" + profile[p] + ") ignored";
				}
				result[p=="layers" ? "rawLayers" : p]= profile[p]=="false" ? false : profile[p];
			}
			result.localeList = result.localeList.split(",");

			// TODOC: we now take care of the console without shrink safe
			// TODO/TODOC: burn in dojoConfig, djConfig
			// TODOTODOC: dojoConfig, djConfig should be able to be objects (string restrinction lifted)
			// TODOC: action is assumed to be build, no more clean, help if you want it explicitly

			bc.defaultConfig= {
				hasCache: bc.hasCache || {
					"host-browser":1,
					"dom":1,
					"loader-hasApi":1,
					"loader-provides-xhr":1,
					"loader-injectApi":1,
					"loader-timeoutApi":1,
					"loader-traceApi":1,
					"loader-catchApi":1,
					"loader-pageLoadApi":1,
					"loader-priority-readyApi":1,
					"loader-errorApi":1,
					"loader-publish-privates":1,
					"loader-getTextApi":1,
					"dojo-sniff":1,
					"dojo-loader":1,
					"dojo-test-xd":1,
					"dojo-test-sniff":1
				}
			};

			if (result.copyTests) {
				result.trees= [[dojoPath + "/../util/doh", "./util/doh"]];
				bc.defaultConfig.packages= [{
					name:'doh',
					location:'../util/doh',
					lib:'.'
				}];
			}
			return result;
		},

		processProfileFile= function(filename){
			var text= readFileSync(filename, "utf8");

			//Remove the call to getDependencyList.js because it is not supported anymore.
			if (/load\(("|')getDependencyList.js("|')\)/.test(text)) {
				bc.logWarn("load(\"getDependencyList.js\") is no supported.");
				text.replace(/load\(("|')getDependencyList.js("|')\)/, "");
			}

			// how about calling it a profile (instead of v1.6- dependencies)...
			var profile= (function(__text){
				var dependencies= {};
				eval(__text);
				return dependencies;
			})(text);
			return processProfile(profile);
		},

		processHtmlFile= function(filename){
			// TODO
		};

	return {
		processProfile:processProfile,
		processProfileFile:processProfileFile,
		processHtmlFile:processHtmlFile
	};
});
