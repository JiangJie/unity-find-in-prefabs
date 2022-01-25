// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';

const CommandID = 'unity-find-in-prefabs';

const PrefabExtname = '.prefab';
const MetaExtname = '.meta';
const AllPrefabsPattern = `**/*${ PrefabExtname }`;

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
            updateCacheWhenDelectDocument(uri);
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
 * whether an uri is a prefab file
 */
const uriIsPrefabFile = (uri: vscode.Uri) => path.extname(uri.fsPath) === PrefabExtname;

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
    const guids: Set<string> = new Set();

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
            if (matcher) guids.add(matcher[1]);
        }
    } catch (err: any) {
        console.error(`Error from ${ CommandID } when read guids from document ${ uri.fsPath }:\n${ err.message }`);
    }

    return guids;
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
 * delect a prefab from GUIDWithinPrefabs
 */
const delectPrefabWithinGUID = (guid: string, filePath: string) => {
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
    const guids = await readAllScriptGUIDsFromDocument(uri);
    const diff = diffWithTwoSets(PrefabDependOnGUIDs.get(uri.path) || new Set() as Set<string>, guids);

    diff.deleted.forEach(guid => delectPrefabWithinGUID(guid, uri.path));
    diff.added.forEach(guid => addPrefabToGUID(guid, uri.path));

    guids.size ? PrefabDependOnGUIDs.set(uri.path, guids) : PrefabDependOnGUIDs.delete(uri.path);
};

/**
 * update GUIDWithinPrefabs and PrefabDependOnGUIDs when delete prefab file
 */
const updateCacheWhenDelectDocument = (uri: vscode.Uri) => {
    if (!PrefabDependOnGUIDs.has(uri.path)) return;

    const guids = PrefabDependOnGUIDs.get(uri.path)!;
    PrefabDependOnGUIDs.delete(uri.path);

    guids.forEach(guid => delectPrefabWithinGUID(guid, uri.path));
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
 * upgrade cache when prefab file chnaged or added or deleted
 */
const uppradeCacheWhenPrefabChange = (uri: vscode.Uri, isDelete: boolean) => {
    if (!CacheIsBuilt) {
        // record
        isDelete ? DeletedPrefabFilesWhenBuilding.add(uri) : ChangedPrefabFilesWhenBuilding.add(uri);
        return;
    }

    if (isDelete) {
        updateCacheWhenDelectDocument(uri);
        return;
    }

    updateCacheWithUris([uri]);
};

/**
 * get the C# file's guid
 */
const getGUIDOfActiveCsharpFile = async () => {
    // mabey file not exist
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

const createWatcher = () => {
    const watcher = vscode.workspace.createFileSystemWatcher(AllPrefabsPattern);
    watcher.onDidCreate(uri => uriIsPrefabFile(uri) && uppradeCacheWhenPrefabChange(uri, false));
    watcher.onDidChange(uri => uriIsPrefabFile(uri) && uppradeCacheWhenPrefabChange(uri, false));
    watcher.onDidDelete(uri => uriIsPrefabFile(uri) && uppradeCacheWhenPrefabChange(uri, true));
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = (context: vscode.ExtensionContext) => {
    // This line of code will only be executed once when your extension is activated
    console.log('Unity: Find C# In Prefabs is now active!');

    buildCache();
    createWatcher();

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
        // filename as label
        // folder as description
        const selected = await vscode.window.showQuickPick([...GUIDWithinPrefabs.get(guid)!].map(filePath => {
            const relativePath = vscode.workspace.asRelativePath(filePath);
            let dirname = path.dirname(relativePath);
            dirname === '.' && (dirname = '');

            return {
                label: path.basename(relativePath),
                description: dirname,
                // uri
            };
        }), {
            title: `${ getFileNameOfCsharpFile() } be dependent by`,
            placeHolder: 'Select to copy a file name then you can open in Unity.',
            canPickMany: false
        });

        if (!selected) return;

        // open the file
        // vscode.window.showTextDocument(selected.uri);

        // copy file name(not include extname) to clipboard
        vscode.env.clipboard.writeText(path.basename(selected.label, path.extname(selected.label)));
    });

    context.subscriptions.push(disposable);
};

// this method is called when your extension is deactivated
export const deactivate = reset;
