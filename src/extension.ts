// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';

const CommandID = 'unity-find-in-prefabs';

const PrefabSuffix = '.prefab';
const MetaSuffix = '.meta';
// the regexp of match script guid in prefab file
const PrefabScriptGUIDReg = /(?:^|\s*)m_Script\s*:\s*\{[\s\S^,]+,\s*guid\s*\:\s*([0-9a-f]{32})\s*[\s\S^\}]+\}(?:\s*|$)/i;
// the regexp of match guid in meta file
const MetaGUIDReg = /(?:^|\s*)guid\s*:\s*([0-9a-f]{32})(?:\s*|$)/;

// whether cache has been made
let cacheMade = false;
// cache <script guid, the uri prefab file>
const guidWithinPrefabs: Map<string, Set<vscode.Uri>> = new Map();

/**
 * build guid and prefab files map cache
 */
const buildCache = () => vscode.window.withProgress({
    location: vscode.ProgressLocation.Window,
    title: 'Unity: Find C# In Prefabs. Building cache',
    cancellable: false
}, async progress => {
    progress.report({ increment: 0 });

    // get all prefab files
    const uris = await vscode.workspace.findFiles(`**/*${ PrefabSuffix }`, null);
    for await (const uri of uris) {
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
                if (!matcher) continue;

                const guid = matcher[1];
                if (guidWithinPrefabs.has(guid)) {
                    guidWithinPrefabs.get(guid)!.add(uri);
                } else {
                    guidWithinPrefabs.set(guid, new Set([uri]));
                }
            }
        } catch (err: any) {
            console.error(`Error from ${ CommandID } when open prefab file ${ uri.fsPath }:\n${ err.message }`);
        }
    }

    cacheMade = true;
    progress.report({ increment: 100 });

    // notify build cache complete
    vscode.window.showInformationMessage('Build cache complete.');
});

/**
 * get the C# file's guid
 */
const getGUIDOfActiveCsharpFile = async () => {
    // mabey file not exist
    try {
        // read the right meta file of the C# file
        const reader = fs.createReadStream(`${ vscode.window.activeTextEditor!.document.uri.fsPath }${ MetaSuffix }`);
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

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = (context: vscode.ExtensionContext) => {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Unity: Find C# In Prefabs is now active!');

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

        if (!cacheMade) {
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

        if (!guidWithinPrefabs.has(guid)) {
            vscode.window.showInformationMessage('No found prefab files.');
            return;
        }

        // show result in quick pick view
        // filename as label
        // folder as description
        const selected = await vscode.window.showQuickPick([...guidWithinPrefabs.get(guid)!].map(uri => {
            const filePath = vscode.workspace.asRelativePath(uri.path);
            const index = filePath.lastIndexOf('/');
            return {
                label: index === -1 ? filePath : filePath.slice(index + 1),
                description: index === -1 ? '' : filePath.slice(0, index)
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

        // copy file name to clipboard
        vscode.env.clipboard.writeText(selected.label);
    });

    context.subscriptions.push(disposable);

    buildCache();
}

// this method is called when your extension is deactivated
export const deactivate = () => {
    cacheMade = false;
    guidWithinPrefabs.clear();
};
