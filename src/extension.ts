// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Unity: Find C# In Prefabs is now active!');

    // whether cache has been made
    let cacheMade = false;
    // cache <script guid, prefab[]>
    const guidWithinPrefabs: Map<string, Set<string>> = new Map();

    const makeCache = async () => {
        // the regexp of match guid
        const guidReg = /(?:^|\s*)m_Script\s*:\s*\{[\s\S^,]+,\s*guid\s*\:\s*([0-9a-f]{32})\s*[\s\S^\}]+\}(?:\s*|$)/i;

        // get all prefab files
        const files = await vscode.workspace.findFiles('**/*.prefab', null);
        let doneCount = 0;

        files.forEach(async file => {
            let doc: vscode.TextDocument;

            try {
                doc = await vscode.workspace.openTextDocument(file);
            } catch (err: any) {
                console.error(`Error from unity-find-in-prefabs when makeCache:\n${ err.message }`);
                return;
            }

            // get guids
            const lines = doc.getText().split(doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n');
            lines.forEach(x => {
                const matcher = x.match(guidReg);
                if (!matcher) return;

                const guid = matcher[1];
                if (guidWithinPrefabs.has(guid)) {
                    guidWithinPrefabs.get(guid)!.add(file.path);
                } else {
                    guidWithinPrefabs.set(guid, new Set([file.path]));
                }
            });

            doneCount += 1;
            if (doneCount === files.length - 10) {
                cacheMade = true;
            }
        });
    };

    makeCache();

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand('unity-find-in-prefabs', async () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        const { activeTextEditor } = vscode.window;
        if (!activeTextEditor) return;

        const { document } = activeTextEditor;

        if (document.languageId !== 'csharp') {
            vscode.window.showErrorMessage('Only support C# file!');
            return;
        }

        // get the right meta file path of the C# file
        const metaPath = `${ document.uri.path }.meta`;
        // read the meta file
        let metaDoc = null;
        // mabey file not exist
        try {
            metaDoc = await vscode.workspace.openTextDocument(metaPath);
        } catch (err: any) {
            console.error(`Error from unity-find-in-prefabs when open meta file:\n${ err.message }`);
            vscode.window.showErrorMessage(`Can't find the right meta file of the C# file!`);
            return;
        }

        // get the guid from file content
        const guid = (metaDoc.getText().match(/\n?guid:\s+([0-9a-f]{32})\n/) || [])[1];
        if (!guid) {
            vscode.window.showErrorMessage(`GUID of the C# file error!`);
            return;
        }

        if (!cacheMade) {
            vscode.window.showInformationMessage('Please wait for making cache.');
            return;
        }

        if (!guidWithinPrefabs.has(guid)) {
            vscode.window.showInformationMessage('No found prefab files.');
            return;
        }

        // show result
        vscode.window.showInformationMessage(`Find files:\n${ [...guidWithinPrefabs.get(guid)!].join('\n') }`);
    });

    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export const deactivate = () => { }
