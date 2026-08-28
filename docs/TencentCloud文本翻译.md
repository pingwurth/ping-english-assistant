## 1. 接口描述

接口请求域名： mps.tencentcloudapi.com 。

文本翻译，使用 翻译字幕（附加语种）计费项，按1100字符（按照 Unicode 码点数 统计，hello 算5个字符，你好 算2个字符）/分钟折算到时长计费

默认接口请求频率限制：5次/秒。

<div class="rno-api-explorer">
    <div class="rno-api-explorer-inner">
        <div class="rno-api-explorer-hd">
            <div class="rno-api-explorer-title">
                推荐使用 API Explorer
            </div>
            <a href="https://console.cloud.tencent.com/api/explorer?Product=mps&Version=2019-06-12&Action=TextTranslation" class="rno-api-explorer-btn" hotrep="doc.api.explorerbtn"><i class="rno-icon-explorer"></i>点击调试</a>
        </div>
        <div class="rno-api-explorer-body">
            <div class="rno-api-explorer-cont">
                API Explorer 提供了在线调用、签名验证、SDK 代码生成和快速检索接口等能力。您可查看每次调用的请求内容和返回结果以及自动生成 SDK 调用示例。
            </div>
        </div>
    </div>
</div>

## 2. 输入参数

以下请求参数列表仅列出了接口请求参数和部分公共参数，完整公共参数列表见 [公共请求参数](/document/api/862/37572)。

| 参数名称 | 必选 | 类型 | 描述 |
|---------|---------|---------|---------|
| Action | 是 | String | [公共参数](/document/api/862/37572)，本接口取值：TextTranslation。 |
| Version | 是 | String | [公共参数](/document/api/862/37572)，本接口取值：2019-06-12。 |
| Region | 否 | String | [公共参数](/document/api/862/37572)，本接口不需要传递此参数。 |
| SourceText | 是 | String | <p>待翻译的文本，文本统一使用utf-8格式编码，非utf-8格式编码字符会翻译失败，请传入有效文本，html标记等非常规翻译文本可能会翻译失败。单次请求的文本长度需要低于2000字符。</p><br/>示例值：hello |
| Source | 是 | String | <p>源语言，支持：<br>    &quot;auto&quot;: &quot;自动识别（识别为一种语言）&quot;,<br>    &quot;ab&quot;: &quot;阿布哈兹语&quot;,<br>    &quot;ace&quot;: &quot;亚齐语&quot;,<br>    &quot;ach&quot;: &quot;阿乔利语&quot;,<br>    &quot;af&quot;: &quot;南非荷兰语&quot;,<br>    &quot;ak&quot;: &quot;契维语（阿坎语）&quot;,<br>    &quot;am&quot;: &quot;Amharic&quot;,<br>    &quot;ar&quot;: &quot;阿拉伯语&quot;,<br>    &quot;as&quot;: &quot;阿萨姆语&quot;,<br>    &quot;ay&quot;: &quot;艾马拉语&quot;,<br>    &quot;az&quot;: &quot;阿塞拜疆语&quot;,<br>    &quot;ba&quot;: &quot;巴什基尔语&quot;,<br>    &quot;ban&quot;: &quot;巴厘语&quot;,<br>    &quot;bbc&quot;: &quot;巴塔克托巴语&quot;,<br>    &quot;bem&quot;: &quot;Bemba&quot;,<br>    &quot;bew&quot;: &quot;Betawi&quot;,<br>    &quot;bg&quot;: &quot;保加利亚语&quot;,<br>    &quot;bho&quot;: &quot;博杰普尔语&quot;,<br>    &quot;bik&quot;: &quot;Bikol&quot;,<br>    &quot;bm&quot;: &quot;班巴拉语&quot;,<br>    &quot;bn&quot;: &quot;孟加拉语&quot;,<br>    &quot;br&quot;: &quot;布列塔尼语&quot;,<br>    &quot;bs&quot;: &quot;波斯尼亚语&quot;,<br>    &quot;btx&quot;: &quot;巴塔克卡罗语&quot;,<br>    &quot;bts&quot;: &quot;巴塔克西马隆贡语&quot;,<br>    &quot;bua&quot;: &quot;布里亚特语&quot;,<br>    &quot;ca&quot;: &quot;加泰罗尼亚语&quot;,<br>    &quot;ceb&quot;: &quot;宿务语&quot;,<br>    &quot;cgg&quot;: &quot;Kiga&quot;,<br>    &quot;chm&quot;: &quot;草原马里语&quot;,<br>    &quot;ckb&quot;: &quot;库尔德语（索拉尼语）&quot;,<br>    &quot;cnh&quot;: &quot;哈卡钦语&quot;,<br>    &quot;co&quot;: &quot;科西嘉语&quot;,<br>    &quot;crh&quot;: &quot;克里米亚鞑靼语&quot;,<br>    &quot;crs&quot;: &quot;塞舌尔克里奥尔语&quot;,<br>    &quot;cs&quot;: &quot;捷克语&quot;,<br>    &quot;cv&quot;: &quot;楚瓦什语&quot;,<br>    &quot;cy&quot;: &quot;威尔士语&quot;,<br>    &quot;da&quot;: &quot;丹麦语&quot;,<br>    &quot;de&quot;: &quot;德语&quot;,<br>    &quot;din&quot;: &quot;Dinka&quot;,<br>    &quot;doi&quot;: &quot;多格来语&quot;,<br>    &quot;dov&quot;: &quot;敦贝语&quot;,<br>    &quot;dv&quot;: &quot;第维埃语&quot;,<br>    &quot;dz&quot;: &quot;宗卡语&quot;,<br>    &quot;ee&quot;: &quot;Ewe&quot;,<br>    &quot;el&quot;: &quot;希腊语&quot;,<br>    &quot;en&quot;: &quot;英语&quot;,<br>    &quot;eo&quot;: &quot;世界语&quot;,<br>    &quot;es&quot;: &quot;西班牙语&quot;,<br>    &quot;et&quot;: &quot;爱沙尼亚语&quot;,<br>    &quot;eu&quot;: &quot;巴斯克语&quot;,<br>    &quot;fa&quot;: &quot;波斯语&quot;,<br>    &quot;ff&quot;: &quot;富拉语&quot;,<br>    &quot;fi&quot;: &quot;芬兰语&quot;,<br>    &quot;fil&quot;: &quot;菲律宾语（塔加拉语）&quot;,<br>    &quot;fj&quot;: &quot;斐济语&quot;,<br>    &quot;fr&quot;: &quot;法语&quot;,<br>    &quot;fr-CA&quot;: &quot;法语（加拿大）&quot;,<br>    &quot;fr-FR&quot;: &quot;法语（法国）&quot;,<br>    &quot;fy&quot;: &quot;弗里斯兰语&quot;,<br>    &quot;ga&quot;: &quot;爱尔兰语&quot;,<br>    &quot;gaa&quot;: &quot;加 (Ga) 语&quot;,<br>    &quot;gd&quot;: &quot;苏格兰盖尔语&quot;,<br>    &quot;gl&quot;: &quot;加利西亚语&quot;,<br>    &quot;gn&quot;: &quot;瓜拉尼语&quot;,<br>    &quot;gom&quot;: &quot;贡根语&quot;,<br>    &quot;gu&quot;: &quot;古吉拉特语&quot;,<br>    &quot;gv&quot;: &quot;马恩岛语&quot;,<br>    &quot;ha&quot;: &quot;Hausa&quot;,<br>    &quot;haw&quot;: &quot;夏威夷语&quot;,<br>    &quot;he&quot;: &quot;希伯来语&quot;,<br>    &quot;hi&quot;: &quot;印地语&quot;,<br>    &quot;hil&quot;: &quot;希利盖农语&quot;,<br>    &quot;hmn&quot;: &quot;苗语&quot;,<br>    &quot;hr&quot;: &quot;克罗地亚语&quot;,<br>    &quot;hrx&quot;: &quot;洪斯吕克语&quot;,<br>    &quot;ht&quot;: &quot;海地克里奥尔语&quot;,<br>    &quot;hu&quot;: &quot;匈牙利语&quot;,<br>    &quot;hy&quot;: &quot;亚美尼亚语&quot;,<br>    &quot;id&quot;: &quot;印度尼西亚语&quot;,<br>    &quot;ig&quot;: &quot;Igbo&quot;,<br>    &quot;ilo&quot;: &quot;伊洛果语&quot;,<br>    &quot;is&quot;: &quot;冰岛语&quot;,<br>    &quot;it&quot;: &quot;意大利语&quot;,<br>    &quot;iw&quot;: &quot;希伯来语&quot;,<br>    &quot;ja&quot;: &quot;日语&quot;,<br>    &quot;jv&quot;: &quot;爪哇语&quot;,<br>    &quot;jw&quot;: &quot;爪哇语&quot;,<br>    &quot;ka&quot;: &quot;格鲁吉亚语&quot;,<br>    &quot;kk&quot;: &quot;哈萨克语&quot;,<br>    &quot;km&quot;: &quot;高棉语&quot;,<br>    &quot;kn&quot;: &quot;卡纳达语&quot;,<br>    &quot;ko&quot;: &quot;韩语&quot;,<br>    &quot;kri&quot;: &quot;Krio&quot;,<br>    &quot;ku&quot;: &quot;库尔德语（库尔曼吉语）&quot;,<br>    &quot;ktu&quot;: &quot;吉土巴语&quot;,<br>    &quot;ky&quot;: &quot;吉尔吉斯语&quot;,<br>    &quot;la&quot;: &quot;拉丁语&quot;,<br>    &quot;lb&quot;: &quot;卢森堡语&quot;,<br>    &quot;lg&quot;: &quot;干达语（卢干达语）&quot;,<br>    &quot;li&quot;: &quot;林堡语&quot;,<br>    &quot;lij&quot;: &quot;利古里亚语&quot;,<br>    &quot;lmo&quot;: &quot;伦巴第语&quot;,<br>    &quot;ln&quot;: &quot;林加拉语&quot;,<br>    &quot;lo&quot;: &quot;老挝语&quot;,<br>    &quot;lt&quot;: &quot;立陶宛语&quot;,<br>    &quot;ltg&quot;: &quot;拉特加莱语&quot;,<br>    &quot;luo&quot;: &quot;Luo&quot;,<br>    &quot;lus&quot;: &quot;米佐语&quot;,<br>    &quot;lv&quot;: &quot;拉脱维亚语&quot;,<br>    &quot;mai&quot;: &quot;迈蒂利语&quot;,<br>    &quot;mak&quot;: &quot;马卡萨&quot;,<br>    &quot;mg&quot;: &quot;马尔加什语&quot;,<br>    &quot;mi&quot;: &quot;毛利语&quot;,<br>    &quot;min&quot;: &quot;米南语&quot;,<br>    &quot;mk&quot;: &quot;马其顿语&quot;,<br>    &quot;ml&quot;: &quot;马拉雅拉姆语&quot;,<br>    &quot;mn&quot;: &quot;蒙古语&quot;,<br>    &quot;mr&quot;: &quot;马拉地语&quot;,<br>    &quot;ms&quot;: &quot;马来语&quot;,<br>    &quot;mt&quot;: &quot;马耳他语&quot;,<br>    &quot;my&quot;: &quot;缅甸语&quot;,<br>    &quot;ne&quot;: &quot;尼泊尔语&quot;,<br>    &quot;new&quot;: &quot;尼泊尔语（尼瓦尔语）&quot;,<br>    &quot;nl&quot;: &quot;荷兰语&quot;,<br>    &quot;no&quot;: &quot;挪威语&quot;,<br>    &quot;nr&quot;: &quot;恩德贝莱语（南部）&quot;,<br>    &quot;nso&quot;: &quot;北索托语（塞佩蒂语）&quot;,<br>    &quot;nus&quot;: &quot;努尔语&quot;,<br>    &quot;ny&quot;: &quot;齐切瓦语（尼扬贾语）&quot;,<br>    &quot;oc&quot;: &quot;奥克斯坦语&quot;,<br>    &quot;om&quot;: &quot;Oromo&quot;,<br>    &quot;or&quot;: &quot;奥里亚语（奥里亚）&quot;,<br>    &quot;pa&quot;: &quot;旁遮普语&quot;,<br>    &quot;pag&quot;: &quot;邦阿西楠语&quot;,<br>    &quot;pam&quot;: &quot;邦板牙语&quot;,<br>    &quot;pap&quot;: &quot;Papiamento&quot;,<br>    &quot;pl&quot;: &quot;波兰语&quot;,<br>    &quot;ps&quot;: &quot;Pashto&quot;,<br>    &quot;pt&quot;: &quot;葡萄牙语&quot;,<br>    &quot;pt-BR&quot;: &quot;葡萄牙语（巴西）&quot;,<br>    &quot;pt-PT&quot;: &quot;葡萄牙语（葡萄牙）&quot;,<br>    &quot;qu&quot;: &quot;克丘亚语&quot;,<br>    &quot;ro&quot;: &quot;罗马尼亚语&quot;,<br>    &quot;rom&quot;: &quot;罗姆语&quot;,<br>    &quot;rn&quot;: &quot;Rundi&quot;,<br>    &quot;ru&quot;: &quot;俄语&quot;,<br>    &quot;rw&quot;: &quot;卢旺达语&quot;,<br>    &quot;sa&quot;: &quot;梵语&quot;,<br>    &quot;scn&quot;: &quot;西西里语&quot;,<br>    &quot;sd&quot;: &quot;信德语&quot;,<br>    &quot;sg&quot;: &quot;Sango&quot;,<br>    &quot;shn&quot;: &quot;掸语&quot;,<br>    &quot;si&quot;: &quot;僧伽罗语&quot;,<br>    &quot;sk&quot;: &quot;斯洛伐克语&quot;,<br>    &quot;sl&quot;: &quot;斯洛文尼亚语&quot;,<br>    &quot;sm&quot;: &quot;萨摩亚语&quot;,<br>    &quot;sn&quot;: &quot;修纳语&quot;,<br>    &quot;so&quot;: &quot;索马里语&quot;,<br>    &quot;sq&quot;: &quot;阿尔巴尼亚语&quot;,<br>    &quot;sr&quot;: &quot;塞尔维亚语&quot;,<br>    &quot;ss&quot;: &quot;斯瓦特语&quot;,<br>    &quot;st&quot;: &quot;塞索托语&quot;,<br>    &quot;su&quot;: &quot;巽他语&quot;,<br>    &quot;sv&quot;: &quot;瑞典语&quot;,<br>    &quot;sw&quot;: &quot;斯瓦希里语&quot;,<br>    &quot;szl&quot;: &quot;西里西亚语&quot;,<br>    &quot;ta&quot;: &quot;泰米尔语&quot;,<br>    &quot;te&quot;: &quot;泰卢固语&quot;,<br>    &quot;tet&quot;: &quot;德顿语&quot;,<br>    &quot;tg&quot;: &quot;塔吉克语&quot;,<br>    &quot;th&quot;: &quot;泰语&quot;,<br>    &quot;ti&quot;: &quot;提格里尼亚语&quot;,<br>    &quot;tk&quot;: &quot;土库曼语&quot;,<br>    &quot;tl&quot;: &quot;菲律宾语（塔加拉语）&quot;,<br>    &quot;tn&quot;: &quot;茨瓦纳语&quot;,<br>    &quot;tr&quot;: &quot;土耳其语&quot;,<br>    &quot;ts&quot;: &quot;聪加语&quot;,<br>    &quot;tt&quot;: &quot;鞑靼语&quot;,<br>    &quot;ug&quot;: &quot;维吾尔语&quot;,<br>    &quot;uk&quot;: &quot;乌克兰语&quot;,<br>    &quot;ur&quot;: &quot;乌尔都语&quot;,<br>    &quot;uz&quot;: &quot;乌兹别克语&quot;,<br>    &quot;vi&quot;: &quot;越南语&quot;,<br>    &quot;xh&quot;: &quot;科萨语&quot;,<br>    &quot;yi&quot;: &quot;意第绪语&quot;,<br>    &quot;yo&quot;: &quot;约鲁巴语&quot;,<br>    &quot;yua&quot;: &quot;尤卡坦玛雅语&quot;,<br>    &quot;yue&quot;: &quot;粤语&quot;,<br>    &quot;zh&quot;: &quot;简体中文&quot;,<br>    &quot;zh-TW&quot;: &quot;中文（繁体）&quot;,<br>    &quot;zu&quot;: &quot;祖鲁语&quot;</p><br/>示例值：zh |
| Target | 是 | String | <p>目标语言，支持：<br>    &quot;ab&quot;: &quot;阿布哈兹语&quot;,<br>    &quot;ace&quot;: &quot;亚齐语&quot;,<br>    &quot;ach&quot;: &quot;阿乔利语&quot;,<br>    &quot;af&quot;: &quot;南非荷兰语&quot;,<br>    &quot;ak&quot;: &quot;契维语（阿坎语）&quot;,<br>    &quot;am&quot;: &quot;Amharic&quot;,<br>    &quot;ar&quot;: &quot;阿拉伯语&quot;,<br>    &quot;as&quot;: &quot;阿萨姆语&quot;,<br>    &quot;ay&quot;: &quot;艾马拉语&quot;,<br>    &quot;az&quot;: &quot;阿塞拜疆语&quot;,<br>    &quot;ba&quot;: &quot;巴什基尔语&quot;,<br>    &quot;ban&quot;: &quot;巴厘语&quot;,<br>    &quot;bbc&quot;: &quot;巴塔克托巴语&quot;,<br>    &quot;bem&quot;: &quot;Bemba&quot;,<br>    &quot;bew&quot;: &quot;Betawi&quot;,<br>    &quot;bg&quot;: &quot;保加利亚语&quot;,<br>    &quot;bho&quot;: &quot;博杰普尔语&quot;,<br>    &quot;bik&quot;: &quot;Bikol&quot;,<br>    &quot;bm&quot;: &quot;班巴拉语&quot;,<br>    &quot;bn&quot;: &quot;孟加拉语&quot;,<br>    &quot;br&quot;: &quot;布列塔尼语&quot;,<br>    &quot;bs&quot;: &quot;波斯尼亚语&quot;,<br>    &quot;btx&quot;: &quot;巴塔克卡罗语&quot;,<br>    &quot;bts&quot;: &quot;巴塔克西马隆贡语&quot;,<br>    &quot;bua&quot;: &quot;布里亚特语&quot;,<br>    &quot;ca&quot;: &quot;加泰罗尼亚语&quot;,<br>    &quot;ceb&quot;: &quot;宿务语&quot;,<br>    &quot;cgg&quot;: &quot;Kiga&quot;,<br>    &quot;chm&quot;: &quot;草原马里语&quot;,<br>    &quot;ckb&quot;: &quot;库尔德语（索拉尼语）&quot;,<br>    &quot;cnh&quot;: &quot;哈卡钦语&quot;,<br>    &quot;co&quot;: &quot;科西嘉语&quot;,<br>    &quot;crh&quot;: &quot;克里米亚鞑靼语&quot;,<br>    &quot;crs&quot;: &quot;塞舌尔克里奥尔语&quot;,<br>    &quot;cs&quot;: &quot;捷克语&quot;,<br>    &quot;cv&quot;: &quot;楚瓦什语&quot;,<br>    &quot;cy&quot;: &quot;威尔士语&quot;,<br>    &quot;da&quot;: &quot;丹麦语&quot;,<br>    &quot;de&quot;: &quot;德语&quot;,<br>    &quot;din&quot;: &quot;Dinka&quot;,<br>    &quot;doi&quot;: &quot;多格来语&quot;,<br>    &quot;dov&quot;: &quot;敦贝语&quot;,<br>    &quot;dv&quot;: &quot;第维埃语&quot;,<br>    &quot;dz&quot;: &quot;宗卡语&quot;,<br>    &quot;ee&quot;: &quot;Ewe&quot;,<br>    &quot;el&quot;: &quot;希腊语&quot;,<br>    &quot;en&quot;: &quot;英语&quot;,<br>    &quot;eo&quot;: &quot;世界语&quot;,<br>    &quot;es&quot;: &quot;西班牙语&quot;,<br>    &quot;et&quot;: &quot;爱沙尼亚语&quot;,<br>    &quot;eu&quot;: &quot;巴斯克语&quot;,<br>    &quot;fa&quot;: &quot;波斯语&quot;,<br>    &quot;ff&quot;: &quot;富拉语&quot;,<br>    &quot;fi&quot;: &quot;芬兰语&quot;,<br>    &quot;fil&quot;: &quot;菲律宾语（塔加拉语）&quot;,<br>    &quot;fj&quot;: &quot;斐济语&quot;,<br>    &quot;fr&quot;: &quot;法语&quot;,<br>    &quot;fr-CA&quot;: &quot;法语（加拿大）&quot;,<br>    &quot;fr-FR&quot;: &quot;法语（法国）&quot;,<br>    &quot;fy&quot;: &quot;弗里斯兰语&quot;,<br>    &quot;ga&quot;: &quot;爱尔兰语&quot;,<br>    &quot;gaa&quot;: &quot;加 (Ga) 语&quot;,<br>    &quot;gd&quot;: &quot;苏格兰盖尔语&quot;,<br>    &quot;gl&quot;: &quot;加利西亚语&quot;,<br>    &quot;gn&quot;: &quot;瓜拉尼语&quot;,<br>    &quot;gom&quot;: &quot;贡根语&quot;,<br>    &quot;gu&quot;: &quot;古吉拉特语&quot;,<br>    &quot;gv&quot;: &quot;马恩岛语&quot;,<br>    &quot;ha&quot;: &quot;Hausa&quot;,<br>    &quot;haw&quot;: &quot;夏威夷语&quot;,<br>    &quot;he&quot;: &quot;希伯来语&quot;,<br>    &quot;hi&quot;: &quot;印地语&quot;,<br>    &quot;hil&quot;: &quot;希利盖农语&quot;,<br>    &quot;hmn&quot;: &quot;苗语&quot;,<br>    &quot;hr&quot;: &quot;克罗地亚语&quot;,<br>    &quot;hrx&quot;: &quot;洪斯吕克语&quot;,<br>    &quot;ht&quot;: &quot;海地克里奥尔语&quot;,<br>    &quot;hu&quot;: &quot;匈牙利语&quot;,<br>    &quot;hy&quot;: &quot;亚美尼亚语&quot;,<br>    &quot;id&quot;: &quot;印度尼西亚语&quot;,<br>    &quot;ig&quot;: &quot;Igbo&quot;,<br>    &quot;ilo&quot;: &quot;伊洛果语&quot;,<br>    &quot;is&quot;: &quot;冰岛语&quot;,<br>    &quot;it&quot;: &quot;意大利语&quot;,<br>    &quot;iw&quot;: &quot;希伯来语&quot;,<br>    &quot;ja&quot;: &quot;日语&quot;,<br>    &quot;jv&quot;: &quot;爪哇语&quot;,<br>    &quot;jw&quot;: &quot;爪哇语&quot;,<br>    &quot;ka&quot;: &quot;格鲁吉亚语&quot;,<br>    &quot;kk&quot;: &quot;哈萨克语&quot;,<br>    &quot;km&quot;: &quot;高棉语&quot;,<br>    &quot;kn&quot;: &quot;卡纳达语&quot;,<br>    &quot;ko&quot;: &quot;韩语&quot;,<br>    &quot;kri&quot;: &quot;Krio&quot;,<br>    &quot;ku&quot;: &quot;库尔德语（库尔曼吉语）&quot;,<br>    &quot;ktu&quot;: &quot;吉土巴语&quot;,<br>    &quot;ky&quot;: &quot;吉尔吉斯语&quot;,<br>    &quot;la&quot;: &quot;拉丁语&quot;,<br>    &quot;lb&quot;: &quot;卢森堡语&quot;,<br>    &quot;lg&quot;: &quot;干达语（卢干达语）&quot;,<br>    &quot;li&quot;: &quot;林堡语&quot;,<br>    &quot;lij&quot;: &quot;利古里亚语&quot;,<br>    &quot;lmo&quot;: &quot;伦巴第语&quot;,<br>    &quot;ln&quot;: &quot;林加拉语&quot;,<br>    &quot;lo&quot;: &quot;老挝语&quot;,<br>    &quot;lt&quot;: &quot;立陶宛语&quot;,<br>    &quot;ltg&quot;: &quot;拉特加莱语&quot;,<br>    &quot;luo&quot;: &quot;Luo&quot;,<br>    &quot;lus&quot;: &quot;米佐语&quot;,<br>    &quot;lv&quot;: &quot;拉脱维亚语&quot;,<br>    &quot;mai&quot;: &quot;迈蒂利语&quot;,<br>    &quot;mak&quot;: &quot;马卡萨&quot;,<br>    &quot;mg&quot;: &quot;马尔加什语&quot;,<br>    &quot;mi&quot;: &quot;毛利语&quot;,<br>    &quot;min&quot;: &quot;米南语&quot;,<br>    &quot;mk&quot;: &quot;马其顿语&quot;,<br>    &quot;ml&quot;: &quot;马拉雅拉姆语&quot;,<br>    &quot;mn&quot;: &quot;蒙古语&quot;,<br>    &quot;mr&quot;: &quot;马拉地语&quot;,<br>    &quot;ms&quot;: &quot;马来语&quot;,<br>    &quot;mt&quot;: &quot;马耳他语&quot;,<br>    &quot;my&quot;: &quot;缅甸语&quot;,<br>    &quot;ne&quot;: &quot;尼泊尔语&quot;,<br>    &quot;new&quot;: &quot;尼泊尔语（尼瓦尔语）&quot;,<br>    &quot;nl&quot;: &quot;荷兰语&quot;,<br>    &quot;no&quot;: &quot;挪威语&quot;,<br>    &quot;nr&quot;: &quot;恩德贝莱语（南部）&quot;,<br>    &quot;nso&quot;: &quot;北索托语（塞佩蒂语）&quot;,<br>    &quot;nus&quot;: &quot;努尔语&quot;,<br>    &quot;ny&quot;: &quot;齐切瓦语（尼扬贾语）&quot;,<br>    &quot;oc&quot;: &quot;奥克斯坦语&quot;,<br>    &quot;om&quot;: &quot;Oromo&quot;,<br>    &quot;or&quot;: &quot;奥里亚语（奥里亚）&quot;,<br>    &quot;pa&quot;: &quot;旁遮普语&quot;,<br>    &quot;pag&quot;: &quot;邦阿西楠语&quot;,<br>    &quot;pam&quot;: &quot;邦板牙语&quot;,<br>    &quot;pap&quot;: &quot;Papiamento&quot;,<br>    &quot;pl&quot;: &quot;波兰语&quot;,<br>    &quot;ps&quot;: &quot;Pashto&quot;,<br>    &quot;pt&quot;: &quot;葡萄牙语&quot;,<br>    &quot;pt-BR&quot;: &quot;葡萄牙语（巴西）&quot;,<br>    &quot;pt-PT&quot;: &quot;葡萄牙语（葡萄牙）&quot;,<br>    &quot;qu&quot;: &quot;克丘亚语&quot;,<br>    &quot;ro&quot;: &quot;罗马尼亚语&quot;,<br>    &quot;rom&quot;: &quot;罗姆语&quot;,<br>    &quot;rn&quot;: &quot;Rundi&quot;,<br>    &quot;ru&quot;: &quot;俄语&quot;,<br>    &quot;rw&quot;: &quot;卢旺达语&quot;,<br>    &quot;sa&quot;: &quot;梵语&quot;,<br>    &quot;scn&quot;: &quot;西西里语&quot;,<br>    &quot;sd&quot;: &quot;信德语&quot;,<br>    &quot;sg&quot;: &quot;Sango&quot;,<br>    &quot;shn&quot;: &quot;掸语&quot;,<br>    &quot;si&quot;: &quot;僧伽罗语&quot;,<br>    &quot;sk&quot;: &quot;斯洛伐克语&quot;,<br>    &quot;sl&quot;: &quot;斯洛文尼亚语&quot;,<br>    &quot;sm&quot;: &quot;萨摩亚语&quot;,<br>    &quot;sn&quot;: &quot;修纳语&quot;,<br>    &quot;so&quot;: &quot;索马里语&quot;,<br>    &quot;sq&quot;: &quot;阿尔巴尼亚语&quot;,<br>    &quot;sr&quot;: &quot;塞尔维亚语&quot;,<br>    &quot;ss&quot;: &quot;斯瓦特语&quot;,<br>    &quot;st&quot;: &quot;塞索托语&quot;,<br>    &quot;su&quot;: &quot;巽他语&quot;,<br>    &quot;sv&quot;: &quot;瑞典语&quot;,<br>    &quot;sw&quot;: &quot;斯瓦希里语&quot;,<br>    &quot;szl&quot;: &quot;西里西亚语&quot;,<br>    &quot;ta&quot;: &quot;泰米尔语&quot;,<br>    &quot;te&quot;: &quot;泰卢固语&quot;,<br>    &quot;tet&quot;: &quot;德顿语&quot;,<br>    &quot;tg&quot;: &quot;塔吉克语&quot;,<br>    &quot;th&quot;: &quot;泰语&quot;,<br>    &quot;ti&quot;: &quot;提格里尼亚语&quot;,<br>    &quot;tk&quot;: &quot;土库曼语&quot;,<br>    &quot;tl&quot;: &quot;菲律宾语（塔加拉语）&quot;,<br>    &quot;tn&quot;: &quot;茨瓦纳语&quot;,<br>    &quot;tr&quot;: &quot;土耳其语&quot;,<br>    &quot;ts&quot;: &quot;聪加语&quot;,<br>    &quot;tt&quot;: &quot;鞑靼语&quot;,<br>    &quot;ug&quot;: &quot;维吾尔语&quot;,<br>    &quot;uk&quot;: &quot;乌克兰语&quot;,<br>    &quot;ur&quot;: &quot;乌尔都语&quot;,<br>    &quot;uz&quot;: &quot;乌兹别克语&quot;,<br>    &quot;vi&quot;: &quot;越南语&quot;,<br>    &quot;xh&quot;: &quot;科萨语&quot;,<br>    &quot;yi&quot;: &quot;意第绪语&quot;,<br>    &quot;yo&quot;: &quot;约鲁巴语&quot;,<br>    &quot;yua&quot;: &quot;尤卡坦玛雅语&quot;,<br>    &quot;yue&quot;: &quot;粤语&quot;,<br>    &quot;zh&quot;: &quot;简体中文&quot;,<br>    &quot;zh-TW&quot;: &quot;中文（繁体）&quot;,<br>    &quot;zu&quot;: &quot;祖鲁语&quot;</p><br/>示例值：en |
| UserExtPara | 否 | String | <p>用户拓展参数</p><br/>示例值：用户扩展字段 |

## 3. 输出参数

| 参数名称 | 类型 | 描述 |
|---------|---------|---------|
| TargetText | String | <p>翻译后的文本</p><br/>示例值：你好|
| Source | String | <p>源语言，详见入参Source</p><br/>示例值：zh|
| Target | String | <p>目标语言，详见入参Target</p><br/>示例值：en|
| RequestId | String | 唯一请求 ID，由服务端生成，每次请求都会返回（若请求因其他原因未能抵达服务端，则该次请求不会获得 RequestId）。定位问题时需要提供该次请求的 RequestId。|

## 4. 示例

### 示例1 文本翻译请求示例

#### 输入示例

```
POST / HTTP/1.1
Host: mps.tencentcloudapi.com
Content-Type: application/json
X-TC-Action: TextTranslation
<公共请求参数>

{
    "SourceText": "hello",
    "Source": "en",
    "Target": "zh"
}
```

#### 输出示例

```json
{
    "Response": {
        "RequestId": "6411c585-ee14-4a53-8642-dea0f16e161d",
        "Source": "en",
        "Target": "zh",
        "TargetText": "你好"
    }
}
```


## 5. 开发者资源

### 腾讯云 API 平台

[腾讯云 API 平台](https://cloud.tencent.com/api) 是综合 API 文档、错误码、API Explorer 及 SDK 等资源的统一查询平台，方便您从同一入口查询及使用腾讯云提供的所有 API 服务。

### API Inspector

用户可通过 [API Inspector](https://cloud.tencent.com/document/product/1278/49361) 查看控制台每一步操作关联的 API 调用情况，并自动生成各语言版本的 API 代码，也可前往 [API Explorer](https://cloud.tencent.com/document/product/1278/46697) 进行在线调试。

### SDK

云 API 3.0 提供了配套的开发工具集（SDK），支持多种编程语言，能更方便的调用 API。
* Tencent Cloud SDK 3.0 for Python: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-python/-/blob/master/tencentcloud/mps/v20190612/mps_client.py), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-python/blob/master/tencentcloud/mps/v20190612/mps_client.py), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-python/blob/master/tencentcloud/mps/v20190612/mps_client.py)
* Tencent Cloud SDK 3.0 for Java: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-java/-/blob/master/src/main/java/com/tencentcloudapi/mps/v20190612/MpsClient.java), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-java/blob/master/src/main/java/com/tencentcloudapi/mps/v20190612/MpsClient.java), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-java/blob/master/src/main/java/com/tencentcloudapi/mps/v20190612/MpsClient.java)
* Tencent Cloud SDK 3.0 for PHP: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-php/-/blob/master/src/TencentCloud/Mps/V20190612/MpsClient.php), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-php/blob/master/src/TencentCloud/Mps/V20190612/MpsClient.php), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-php/blob/master/src/TencentCloud/Mps/V20190612/MpsClient.php)
* Tencent Cloud SDK 3.0 for Go: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-go/-/blob/master/tencentcloud/mps/v20190612/client.go), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-go/blob/master/tencentcloud/mps/v20190612/client.go), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-go/blob/master/tencentcloud/mps/v20190612/client.go)
* Tencent Cloud SDK 3.0 for Node.js: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-nodejs/-/blob/master/src/services/mps/v20190612/mps_client.ts), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/mps/v20190612/mps_client.ts), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/mps/v20190612/mps_client.ts)
* Tencent Cloud SDK 3.0 for .NET: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-dotnet/-/blob/master/TencentCloud/Mps/V20190612/MpsClient.cs), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-dotnet/blob/master/TencentCloud/Mps/V20190612/MpsClient.cs), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-dotnet/blob/master/TencentCloud/Mps/V20190612/MpsClient.cs)
* Tencent Cloud SDK 3.0 for C++: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-cpp/-/blob/master/mps/src/v20190612/MpsClient.cpp), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-cpp/blob/master/mps/src/v20190612/MpsClient.cpp), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-cpp/blob/master/mps/src/v20190612/MpsClient.cpp)
* Tencent Cloud SDK 3.0 for Ruby: [CNB](https://cnb.cool/tencent/cloud/api/sdk/tencentcloud-sdk-ruby/-/blob/master/tencentcloud-sdk-mps/lib/v20190612/client.rb), [GitHub](https://github.com/TencentCloud/tencentcloud-sdk-ruby/blob/master/tencentcloud-sdk-mps/lib/v20190612/client.rb), [Gitee](https://gitee.com/TencentCloud/tencentcloud-sdk-ruby/blob/master/tencentcloud-sdk-mps/lib/v20190612/client.rb)

### 命令行工具

* [Tencent Cloud CLI 3.0](https://cloud.tencent.com/document/product/440/6176)

## 6. 错误码

以下仅列出了接口业务逻辑相关的错误码，其他错误码详见 [公共错误码](/document/api/862/37616#.E5.85.AC.E5.85.B1.E9.94.99.E8.AF.AF.E7.A0.81)。

| 错误码 | 描述 |
|---------|---------|
| InvalidParameterValue.SourceLanguage | SourceLanguage参数错误 |
| InvalidParameterValue.SourceText | SourceText参数错误 |
| InvalidParameterValue.TextContent | TextContent参数值错误 |
| InvalidParameterValue.TranslateDstLanguage | 参数值错误：翻译目标语言 |
| ResourceNotFound.UserUnregister | 用户未注册。 |
| UnsupportedOperation.TextTooLong | 单次请求text超过长度限制 |
