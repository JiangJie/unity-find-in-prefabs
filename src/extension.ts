// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';

const CommandID = 'unity-find-in-prefabs';

const PrefabExtname = '.prefab';
const SceneExtname = '.unity';
const MetaExtname = '.meta';
const AllPrefabsPattern = '**/*.{prefab,unity}';

// the regexp of match script guid in prefab file
const PrefabScriptGUIDReg = /(?:^|\s*)m_Script\s*:\s*\{[\s\S^,]+,\s*guid\s*\:\s*([0-9a-f]{32})\s*[\s\S^\}]+\}(?:\s*|$)/i;

// the regexp of match guid in meta file
const MetaGUIDReg = /(?:^|\s*)guid\s*:\s*([0-9a-f]{32})(?:\s*|$)/;

// guids and prefabs are many-to-many relationship

// one-to-many: cache <script guid, prefab path set>
// used for find
const GUIDWithinPrefabs: Map<string, Set<string>> = new Map();

// one-to-many: cache <prefab path, script guid set>
// used for update cache
const PrefabDependOnGUIDs: Map<string, Set<string>> = new Map();

/**
 * record updated or added prefab files when building cache
 */
const ChangedPrefabFilesWhenBuilding: Set<vscode.Uri> = new Set();

/**
 * record deleted prefab files when building cache
 */
const DeletedPrefabFilesWhenBuilding: Set<vscode.Uri> = new Set();

// whether cache is building or built
let CacheIsBuilt = false;

const setAsBuildingCache = () => CacheIsBuilt = false;
const setAsBuiltCache = () => {
    CacheIsBuilt = true;
    // handle ChangedPrefabFilesWhenBuilding and DeletedPrefabFilesWhenBuilding records
    if (ChangedPrefabFilesWhenBuilding.size) {
        updateCacheWithUris([...ChangedPrefabFilesWhenBuilding]);
        ChangedPrefabFilesWhenBuilding.clear();
    }
    if (DeletedPrefabFilesWhenBuilding.size) {
        for (const uri of DeletedPrefabFilesWhenBuilding) {
            updateCacheWhenDeleteDocument(uri);
        }
        DeletedPrefabFilesWhenBuilding.clear();
    }
};

/**
 * util function to diff two set
 */
const diffWithTwoSets = <T>(left: Set<T>, right: Set<T>) => ({
    deleted: [...left].filter(x => !right.has(x)),
    added: [...right].filter(x => !left.has(x))
});

/**
 * whether an uri is a prefab or scene file
 */
const uriIsPrefabOrSceneFile = (uri: vscode.Uri) => {
    var extname = path.extname(uri.fsPath);
    return extname === PrefabExtname || extname === SceneExtname;
};

/**
 * reset status
 */
const reset = () => {
    GUIDWithinPrefabs.clear();
    PrefabDependOnGUIDs.clear();
    setAsBuildingCache();
};

/**
 * read all script'guid of given file
 */
const readAllScriptGUIDsFromDocument = async (uri: vscode.Uri) => {
    const guidSet: Set<string> = new Set();

    try {
        const reader = fs.createReadStream(uri.fsPath);
        const rl = readline.createInterface({
            input: reader,
            crlfDelay: Infinity
        });
        // Note: we use the crlfDelay option to recognize all instances of CR LF
        // ('\r\n') in input.txt as a single line break.
        for await (const line of rl) {
            const matcher = line.match(PrefabScriptGUIDReg);
            if (matcher) guidSet.add(matcher[1]);
        }

        rl.close();
        reader.close();
    } catch (err: any) {
        console.error(`Error from ${ CommandID } when read guids from document ${ uri.fsPath }:\n${ err.message }`);
    }

    return guidSet;
};

/**
 * add a prefab file path to GUIDWithinPrefabs
 */
const addPrefabToGUID = (guid: string, filePath: string) => {
    if (GUIDWithinPrefabs.has(guid)) {
        GUIDWithinPrefabs.get(guid)!.add(filePath);
    } else {
        GUIDWithinPrefabs.set(guid, new Set([filePath]));
    }
};

/**
 * delete a prefab from GUIDWithinPrefabs
 */
const deletePrefabWithinGUID = (guid: string, filePath: string) => {
    if (!GUIDWithinPrefabs.has(guid)) return;

    const prefabs = GUIDWithinPrefabs.get(guid)!;
    prefabs.delete(filePath);

    if (!prefabs.size) {
        GUIDWithinPrefabs.delete(guid);
    }
};

/**
 * read the prefab file then update GUIDWithinPrefabs and PrefabDependOnGUIDs
 */
const readDocumentAndUpdateCache = async (uri: vscode.Uri) => {
    const guidSet = await readAllScriptGUIDsFromDocument(uri);
    const diff = diffWithTwoSets(PrefabDependOnGUIDs.get(uri.path) || new Set() as Set<string>, guidSet);

    diff.deleted.forEach(guid => deletePrefabWithinGUID(guid, uri.path));
    diff.added.forEach(guid => addPrefabToGUID(guid, uri.path));

    guidSet.size ? PrefabDependOnGUIDs.set(uri.path, guidSet) : PrefabDependOnGUIDs.delete(uri.path);
};

/**
 * update GUIDWithinPrefabs and PrefabDependOnGUIDs when delete prefab file
 */
const updateCacheWhenDeleteDocument = (uri: vscode.Uri) => {
    if (!PrefabDependOnGUIDs.has(uri.path)) return;

    const guidSet = PrefabDependOnGUIDs.get(uri.path)!;
    PrefabDependOnGUIDs.delete(uri.path);

    guidSet.forEach(guid => deletePrefabWithinGUID(guid, uri.path));
};

/**
 * update cache with given uri array or all prefabs of workspace
 */
const updateCacheWithUris = (uris: vscode.Uri[] | null = null) => vscode.window.withProgress({
    location: vscode.ProgressLocation.Window,
    title: 'Unity: Find C# In Prefabs. Building cache',
    cancellable: true
}, async progress => {
    setAsBuildingCache();

    progress.report({ increment: 0 });

    let _uris = uris;
    if (!_uris) {
        // get all prefab files
        _uris = await vscode.workspace.findFiles(AllPrefabsPattern, null);
    }

    for await (const uri of _uris) {
        await readDocumentAndUpdateCache(uri);
    }

    progress.report({ increment: 100 });
    setAsBuiltCache();
});

/**
 * build guid and prefab files map cache
 */
const buildCache = async () => {
    reset();

    await updateCacheWithUris();
    // notify build cache complete
    vscode.window.showInformationMessage('Build cache complete.');
};

/**
 * upgrade cache when prefab file changed or added or deleted
 */
const upgradeCacheWhenPrefabChange = (uri: vscode.Uri, isDelete: boolean) => {
    if (!CacheIsBuilt) {
        // record
        isDelete ? DeletedPrefabFilesWhenBuilding.add(uri) : ChangedPrefabFilesWhenBuilding.add(uri);
        return;
    }

    if (isDelete) {
        updateCacheWhenDeleteDocument(uri);
        return;
    }

    updateCacheWithUris([uri]);
};

/**
 * get the C# file's guid
 */
const getGUIDOfActiveCsharpFile = async () => {
    // maybe file not exist
    try {
        // read the right meta file of the C# file
        const reader = fs.createReadStream(`${ vscode.window.activeTextEditor!.document.uri.fsPath }${ MetaExtname }`);
        const rl = readline.createInterface({
            input: reader,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const matcher = line.match(MetaGUIDReg);
            if (matcher) return matcher[1];
        }

        return null;
    } catch (err: any) {
        console.error(`Error from ${ CommandID } when open meta file:\n${ err.message }`);
    }
};

/**
 * get the C# file's name
 */
const getFileNameOfCsharpFile = () => path.basename(vscode.window.activeTextEditor!.document.uri.fsPath);

/**
 * watch all prefab files change in workspace
 */
const watchAllPrefabFiles = () => {
    const watcher = vscode.workspace.createFileSystemWatcher(AllPrefabsPattern);
    watcher.onDidCreate(uri => uriIsPrefabOrSceneFile(uri) && upgradeCacheWhenPrefabChange(uri, false));
    watcher.onDidChange(uri => uriIsPrefabOrSceneFile(uri) && upgradeCacheWhenPrefabChange(uri, false));
    watcher.onDidDelete(uri => uriIsPrefabOrSceneFile(uri) && upgradeCacheWhenPrefabChange(uri, true));
};

/**
 * create a quick pick view to show results
 */
const showQuickPickByGUID = (guid: string) => {
    interface WithFilePathQuickPickItem extends vscode.QuickPickItem {
        filePath: string;
    }

    const quickPick = vscode.window.createQuickPick<WithFilePathQuickPickItem>();
    let selectedLabel: string | null = null;

    quickPick.items = [...GUIDWithinPrefabs.get(guid)!].map(filePath => {
        const relativePath = vscode.workspace.asRelativePath(filePath);
        let dirname = path.dirname(relativePath);
        dirname === '.' && (dirname = '');

        // filename as label
        // folder as description
        return {
            label: path.basename(relativePath),
            description: dirname,
            buttons: [{
                iconPath: new vscode.ThemeIcon('explorer-view-icon'),
                tooltip: 'Reveal In Explorer'
            }, {
                iconPath: new vscode.ThemeIcon('open-preview'),
                tooltip: 'Open Preview'
            }],
            filePath
        };
    });

    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.title = `${ getFileNameOfCsharpFile() } be dependent by`;
    quickPick.placeholder = 'Select to copy a file name then you can open in Unity.';

    quickPick.onDidHide(() => {
        selectedLabel = null;
        quickPick.dispose();
    });
    quickPick.onDidChangeSelection(items => selectedLabel = items[0].label);
    quickPick.onDidAccept(() => {
        if (selectedLabel) {
            // copy file name(not include extname) to clipboard
            vscode.env.clipboard.writeText(path.basename(selectedLabel, path.extname(selectedLabel)));
        }

        quickPick.hide();
    });

    quickPick.onDidTriggerItemButton(event => {
        const iconID = (event.button.iconPath as vscode.ThemeIcon).id;
        const uri = vscode.Uri.file(event.item.filePath);

        if (iconID === 'explorer-view-icon') {
            vscode.commands.executeCommand('revealInExplorer', uri);
        } else if (iconID === 'open-preview') {
            vscode.window.showTextDocument(uri);
        }
    });

    quickPick.show();
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = (context: vscode.ExtensionContext) => {
    // This line of code will only be executed once when your extension is activated
    console.log('Unity: Find C# In Prefabs is now active!');

    buildCache();
    watchAllPrefabFiles();

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand(CommandID, async () => {
        // The code you place here will be executed every time your command is executed
        const { activeTextEditor } = vscode.window;
        if (!activeTextEditor) return;

        const { document } = activeTextEditor;

        if (document.languageId !== 'csharp') {
            vscode.window.showErrorMessage('Only support C# file!');
            return;
        }

        if (!CacheIsBuilt) {
            vscode.window.showInformationMessage('Please wait for building cache.');
            return;
        }

        const guid = await getGUIDOfActiveCsharpFile();
        if (guid === undefined) {
            vscode.window.showErrorMessage(`Can't find the right meta file of the C# file!`);
            return;
        }
        if (guid === null) {
            vscode.window.showErrorMessage(`GUID of the C# file error!`);
            return;
        }

        if (!GUIDWithinPrefabs.has(guid)) {
            vscode.window.showInformationMessage('No found prefab files.');
            return;
        }

        // show result in quick pick view
        showQuickPickByGUID(guid);
    });

    context.subscriptions.push(disposable);
};

// this method is called when your extension is deactivated
export const deactivate = reset;
