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

## Road Map

* 优化查找结果的展示UI。
* prefab文件变化更新结果缓存。
* 支持跳转到查找到的prefab文件。
* 支持在scene文件中查找。
* 支持查找其他被应用的文件类型。
* ...
