# unity-find-in-prefabs

## Features

查找C#脚本被哪些prefab文件引用。

## Release Notes

### 1.0.0

* 增加基础功能。

### 1.0.1

* 即使`files.exclude`包含`prefab`文件，现在也能正确查找到了。

### 1.0.2

* 首次Find的时候建立结果缓存，避免每次都全量文件查找。

### 1.0.3

* 使用`Quick Pick`来展示查找结果，然后可以方便打开查找到的某个prefab文件。

### 1.0.4

* 选择查找结果的prefab文件将复制文件名到剪贴板。
* 构建缓存期间在状态栏可以看到提示。
* 增加文件title右键菜单。

### 1.0.5

* `prefab`文件增删改之后自动更新缓存，下次查找直接生效。

### 1.0.6

* 每条结果增加一个预览文件按钮。

## Road Map

* 支持在scene文件中查找。
* 支持查找其他被引用的文件类型。
* 选择查找结果直接打开Unity。
* ...
