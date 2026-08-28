# 机器翻译通用版调用完整工程示例

该项目为TranslateGeneral的完整工程示例。

**工程代码建议使用更安全的无AK方式，凭据配置方式请参阅：[管理访问凭据](https://help.aliyun.com/zh/sdk/developer-reference/v2-manage-node-js-access-credentials)。**

## 运行条件

- 下载并解压需要语言的代码;

- *Node.js >= 8.x*

## 执行步骤

完成凭据配置后，可以在**解压代码所在目录下**按如下的步骤执行：

- *安装依赖*
  ```sh
  npm install --registry=https://registry.npmmirror.com
  ```

- *编译并运行*
  ```sh
  tsc && node ./dist/client.js
  ```

## 使用的 API

-  TranslateGeneral：通用翻译接口调用说明。 更多信息可参考：[文档](https://next.api.aliyun.com/document/alimt/2018-10-12/TranslateGeneral)

## API 返回示例

*下列输出值仅作为参考，实际输出结构可能稍有不同，以实际调用为准。*


- JSON 格式 
```js
{
  "Code": 200,
  "Message": "success",
  "RequestId": "86D18195-D89C-4C8C-9DC4-5FCE789CE6D5",
  "Data": {
    "Translated": "Hello",
    "WordCount": "10",
    "DetectedLanguage": "zh"
  }
}
```

