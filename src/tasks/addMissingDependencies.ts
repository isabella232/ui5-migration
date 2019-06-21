/**
 *  Will check each source file (*.js) for using global jquery functions
 * replaces these functions with the appropriate module such as,
 *  @example
 *  jQuery.sap.assert(true)
 *  require(["sap/base/assert"], function(assert){assert(true);})"
 */
import {Syntax} from "esprima";
import * as ESTree from "estree";
import * as fs from "graceful-fs";
import * as path from "path";
import {ASTReplaceable} from "ui5-migration";

import {EMPTY_FINDER_RESULT, Extender, Finder, FinderResult} from "../dependencies";
import * as Mod from "../Migration";
import {Reporter} from "../reporter/Reporter";
import * as ASTUtils from "../util/ASTUtils";
import {ASTVisitor, NodePath, TNodePath} from "../util/ASTVisitor";
import * as CommentUtils from "../util/CommentUtils";
import {removeModulesNotMatchingTargetVersion} from "../util/ConfigUtils";
import {SapUiDefineCall} from "../util/SapUiDefineCall";

function getDefineCall(
	oAst: ESTree.Node, sModuleName: string, reporter: Reporter) {
	const defineCalls =
		ASTUtils.findCalls(oAst, SapUiDefineCall.isValidRootPath);
	let defineCall = null;

	if (defineCalls.length > 1) {
		return undefined;
	} else if (defineCalls.length === 1) {
		defineCall = defineCalls[0].value;
	} else {
		return undefined;
	}

	return new SapUiDefineCall(defineCall, sModuleName, reporter);
}


function mapToFound(oPath: NodePath, oFound: FoundReplacement): FoundCall {
	return {
		module : oFound.module,
		configName : oFound.configName,
		callPath : oPath,
		iLevel : 0,
		config : oFound.oModuleInner,
		importObj : {
			replacerName : oFound.oModuleInner.replacer,
			extenderName : oFound.oModuleInner.extender,
			newModulePath : oFound.oModuleInner.newModulePath
		}
	};
}

const visit = function(
	analysis: Analysis, oModuleTree: {}, finders: { [name: string]: Finder }) {
	// @ts-ignore
	return function(oPath) {
		const aFound =
			isFoundInConfig(oPath.value, oPath, oModuleTree, finders);
		if (aFound.length > 0) {
			analysis.replaceCalls = analysis.replaceCalls.concat(
				aFound.map(mapToFound.bind(null, oPath)));
			analysis.newRequires = analysis.newRequires.concat(
				aFound.map(function(oFound: FoundReplacement) {
					return { modulePath : oFound.newModulePath };
				}));
			oPath.protect();
			return false;
		}
		this.traverse(oPath);
	};
};

function findCallsToReplace(
	oAST: ESTree.Node, defineCall: SapUiDefineCall, oModuleTree: {},
	finders: { [name: string]: Finder }, visitor: ASTVisitor): Analysis {
	// replace with modules
	const analysis: Analysis = {
		addComments : [],
		defineCall,
		newRequires : [],
		removeRequires : [],
		replaceCalls : []
	};
	const aStack: ESTree.Node[] = [ oAST ];

	while (aStack.length > 0) {
		visitor.visit(aStack.shift(), {
			visitMemberExpression : visit(analysis, oModuleTree, finders),
			// simple-identifier call (e.g. jQuery("xxx"))
			visitCallExpression : visit(analysis, oModuleTree, finders),
			visitBinaryExpression : visit(analysis, oModuleTree, finders),
			visitVariableDeclarator : visit(analysis, oModuleTree, finders),
			visitIdentifier : visit(analysis, oModuleTree, finders),
			visitLogicalExpression : visit(analysis, oModuleTree, finders)
		});
	}

	return analysis;
}


function isFoundInConfig(
	oNode: ESTree.Node, oNodePath: NodePath, oModuleTree: {
		[index: string]:
			{ [index: string]: { finder: string, newModulePath: string } }
	},
	finder: { [name: string]: Finder }): FoundReplacement[] {
	const aCalls = [];
	for (const sModule in oModuleTree) {
		if (oModuleTree.hasOwnProperty(sModule)) {
			const oModule = oModuleTree[sModule];
			for (const sModuleInner in oModule) {
				if (oModule.hasOwnProperty(sModuleInner)) {
					const oModuleInner = oModule[sModuleInner];
					const oFinder: Finder = finder[oModuleInner.finder];
					const oResult: FinderResult =
						oFinder.find(oNode, oModuleInner, sModuleInner);
					if (oResult && oResult !== EMPTY_FINDER_RESULT) {
						aCalls.push({
							module : sModule,
							configName : oResult.configName,
							oModuleInner,
							newModulePath : oModuleInner.newModulePath
						});
					}
				}
			}
		}
	}
	return aCalls;
}


/**
 * global variable to indicate that this replacement does not belong to a
 * module, e.g. jQuery.inArray
 * @type {string}
 */
const GLOBALS = "GLOBALS";

type ModuleTree = {
	[name: string]: ModuleTree
};


interface ImportInfo {
	// e.g. for sap.ui.define(["sap.encoder"], function (j) { j.func(); })
	oldModule: string;		// jQuery.encoder
	newModule?: string;		// sap.encoder
	requireName?: string;   // j
	functionName?: string;  // func
	replacerName: string;
	hasToBeRequired: boolean;
}

type ImportMap = {
	[oldImport: string]: ImportInfo
};

interface FoundReplacement {
	module: string;
	configName: string;
	oModuleInner: {
		replacer?: string,
		extender?: string,
		finder?: string,
		newModulePath?: string
	};
	newModulePath: string;
}

interface ConfigObject {
	replacerName?: string;
	extenderName?: string;
	newModulePath?: string;
	newVariableName?: string;
	functionName?: string;
}

interface FoundCall {
	module: string;
	iLevel: number;
	configName: string;
	config: ConfigObject;
	callPath: NodePath;
	importObj: ConfigObject;
}

interface Analysis {
	defineCall: SapUiDefineCall;
	replaceCalls: FoundCall[];
	removeRequires: string[];
	newRequires: Array<{ modulePath : string; requireName?: string; }>;
	addComments: Array<{ nodePath : NodePath; comment : string; }>;
}

/**
 * Throws an error if finder cannot be found for a module in the config
 * @param {object} config module config
 * @param {[key: string]: Finder} mFinderFuncs alias to Finder object lookup map
 */
function checkFindersInConfig(
	config: object, mFinderFuncs: { [key: string]: Finder }) {
	for (const sModule in config) {
		if (config.hasOwnProperty(sModule)) {
			const oModule = config[sModule];
			for (const sModuleInner in oModule) {
				if (oModule.hasOwnProperty(sModuleInner)) {
					const oModuleInner = oModule[sModuleInner];
					const oFinder: Finder = mFinderFuncs[oModuleInner.finder];
					if (!oFinder) {
						throw new Error(`Failed to find Finder for "${
							oModuleInner.finder}"`);
					}
				}
			}
		}
	}
}

async function analyse(args: Mod.AnalyseArguments): Promise<{}|undefined> {
	if (!args.config) {
		throw new Error("No configuration given");
	}
	const visitor = args.visitor as ASTVisitor || new ASTVisitor();

	const ast = args.file.getAST();


	// if there is no define call where dependency could be added -> resolve and
	// return
	const defineCall =
		getDefineCall(ast, args.file.getFileName(), args.reporter);
	if (!defineCall) {
		args.reporter.report(
			Mod.ReportLevel.TRACE,
			"could not find sap.ui.define call for " + args.file.getFileName());
		return undefined;
	} else if (!defineCall.factory) {
		args.reporter.report(
			Mod.ReportLevel.WARNING,
			"unsupported sap.ui.define without factory found for " +
				args.file.getFileName());
		return undefined;
	}
	const mFinderFuncs:
		{ [name: string]: Finder } = {};  // TODO: Add function interface

	if (!args.config.finders) {
		throw new Error("No finders configured");
	}

	for (const finderName in args.config.finders) {
		if (args.config.finders.hasOwnProperty(finderName)) {
			const modulePath =
				path.join(__dirname, "..", args.config.finders[finderName]);
			mFinderFuncs[finderName] = require(modulePath);
		}
	}

	checkFindersInConfig(args.config.modules, mFinderFuncs);

	const oConfig = args.targetVersion !== "latest" ?
		removeModulesNotMatchingTargetVersion(args.config, args.targetVersion) :
		args.config;

	const oAnalysis = findCallsToReplace(
		ast, defineCall, oConfig.modules, mFinderFuncs, visitor);
	args.reporter.collect("replacementsFound", oAnalysis.replaceCalls.length);
	return oAnalysis;
}


async function migrate(args: Mod.MigrateArguments): Promise<boolean> {
	if (!args.config || !args.analyseResult) {
		args.reporter.report(
			Mod.ReportLevel.ERROR, "no config or nothing to analyze");
		return false;
	}
	const visitor = args.visitor || new ASTVisitor();
	const analyseResult = (args.analyseResult) as Analysis;

	// Loader replacer functions
	const mReplacerFuncs:
		{ [name: string]:
			  ASTReplaceable } = {};  // TODO: Add function interface
	const mExtenderFuncs:
		{ [name: string]: Extender } = {};  // TODO: Add function interface
	if (!args.config.replacers) {
		throw new Error("No replacers configured");
	}
	for (const replacerName in args.config.replacers) {
		if (args.config.replacers.hasOwnProperty(replacerName)) {
			const modulePath =
				path.join(__dirname, "..", args.config.replacers[replacerName]);
			mReplacerFuncs[replacerName] = require(modulePath);
		}
	}

	if (!args.config.extenders) {
		throw new Error("No extenders configured");
	}
	for (const extenderName in args.config.extenders) {
		if (args.config.extenders.hasOwnProperty(extenderName)) {
			const modulePath =
				path.join(__dirname, "..", args.config.extenders[extenderName]);
			mExtenderFuncs[extenderName] = require(modulePath);
		}
	}

	let bFileModified = false;
	let bFileIgnored = false;

	// Replace calls : FoundCall
	for (const oReplace of analyseResult.replaceCalls) {
		let oNodePath: NodePath = oReplace.callPath;
		for (let i = 0; i < oReplace.iLevel; i++) {
			oNodePath = visitor.visitSingle(oNodePath, "object");
		}

		// Try to replace the call
		try {
			mReplacerFuncs[oReplace.importObj.replacerName].replace(
				oNodePath, oReplace.config.newVariableName,
				oReplace.config.functionName, oReplace.module, oReplace.config);

			// modify define call
			const oExtender: Extender =
				mExtenderFuncs[oReplace.importObj.extenderName];
			oExtender.extend(analyseResult.defineCall, oReplace.config);

			args.reporter.collect("replacementsPerformed", 1);
			if (oNodePath.parentPath.value.type === Syntax.MemberExpression &&
				oNodePath.parentPath.value.property.type ===
					Syntax.Identifier &&
				oNodePath.parentPath.value.property.name) {
				args.reporter.collect(
					oNodePath.parentPath.value.property.name, 1);
			}

			bFileModified = true;
		} catch (e) {
			args.reporter.report(
				Mod.ReportLevel.WARNING,
				"ignored element: " + oReplace.configName, oNodePath.value.loc);
			args.reporter.report(Mod.ReportLevel.ERROR, e, oNodePath.value.loc);
			args.reporter.collect("replacementsIgnored", 1);

			bFileIgnored = true;
			if (args.config.comments) {
				CommentUtils.addComment(
					oNodePath, args.config.comments.failedReplacementComment);
				bFileModified = true;
			}
		}
	}

	// add comments
	for (const oComment of analyseResult.addComments) {
		if (CommentUtils.addComment(oComment.nodePath, oComment.comment)) {
			bFileModified = true;
		}
	}
	if (bFileModified) {
		args.reporter.collect("fileModified", 1);
	}

	if (bFileIgnored) {
		args.reporter.collect("fileIgnored", 1);
	}
	return bFileModified;
}

const replaceGlobals: Mod.Task = {
	description :
		"Checks usage of jQuery function extensions and ensures module imports are correct",
	keywords : [ "all", "fix-jquery-plugin-imports" ],
	priority : 5,
	defaultConfig() {
		return Promise.resolve(JSON.parse(fs.readFileSync(
			path.join(
				__dirname,
				"../../../defaultConfig/addMissingDependencies.config.json"),
			"utf8")));
	},
	// TODO: add config schema

	analyse,
	migrate
};

export = replaceGlobals;
