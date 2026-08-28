// 依赖的模块可通过下载工程中的模块依赖文件或右上角的获取 SDK 依赖信息查看
import alimt20181012, * as $alimt20181012 from '@alicloud/alimt20181012';
import OpenApi, * as $OpenApi from '@alicloud/openapi-client';
import Util, * as $Util from '@alicloud/tea-util';
import Credential from '@alicloud/credentials';
import * as $tea from '@alicloud/tea-typescript';


export default class Client {

  /**
   * @remarks
   * 使用凭据初始化账号Client
   * @returns Client
   * 
   * @throws Exception
   */
  static createClient(): alimt20181012 {
    // 工程代码建议使用更安全的无AK方式，凭据配置方式请参见：https://help.aliyun.com/document_detail/378664.html。
    let credential = new Credential();
    let config = new $OpenApi.Config({
      credential: credential,
    });
    // Endpoint 请参考 https://api.aliyun.com/product/alimt
    config.endpoint = `mt.aliyuncs.com`;
    return new alimt20181012(config);
  }

  static async main(args: string[]): Promise<void> {
    let client = Client.createClient();
    let translateGeneralRequest = new $alimt20181012.TranslateGeneralRequest({ });
    let runtime = new $Util.RuntimeOptions({ });
    try {
      let resp = await client.translateGeneralWithOptions(translateGeneralRequest, runtime);
      console.log(JSON.stringify(resp, null, 2));
    } catch (error) {
      // 此处仅做打印展示，请谨慎对待异常处理，在工程项目中切勿直接忽略异常。
      // 错误 message
      console.log(error.message);
      // 诊断地址
      console.log(error.data["Recommend"]);
    }    
  }

}

Client.main(process.argv.slice(2));