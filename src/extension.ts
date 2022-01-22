// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export const activate = (context: vscode.ExtensionContext) => {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Unity: Find C# In Prefabs is now active!');

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
            console.error(`Error from unity-find-in-prefabs:\n${ err.message }`);
            vscode.window.showErrorMessage(`Can't find the right meta file of the C# file!`);
            return;
        }

        // get the guid from file content
        const guid = (metaDoc.getText().match(/\n?guid:\s+([0-9a-f]{32})\n/) || [])[1];
        if (!guid) {
            vscode.window.showErrorMessage(`GUID of the C# file error!`);
            return;
        }

        // get all prefab files
        const files = await vscode.workspace.findFiles('**/*.prefab', null);
        // map then filtered files
        const findedPrefabFiles = (await Promise.all(files.map(async file => {
            const doc = await vscode.workspace.openTextDocument(file);
            return doc.getText().match(new RegExp(`guid:\\s+${ guid }`)) ? file.path : null;
        }))).filter(x => !!x);

        // no found
        if (!findedPrefabFiles.length) {
            vscode.window.showInformationMessage('No found prefab files.');
            return;
        }

        // show result
        vscode.window.showInformationMessage(`Find files:\n${ findedPrefabFiles.join('\n') }`);
    });

    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export const deactivate = () => { }
