import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/android_update_notice.dart';

void main() {
  Map<String,dynamic> release(String tag,{bool draft=false,bool preview=true,
    bool asset=true}) => {
    'tag_name':tag,'draft':draft,'prerelease':preview,
    'assets':asset?[{'name':'NASQO-PRO-ERP.apk','state':'uploaded','size':1024,
      'browser_download_url':'https://untrusted.example/file.apk'}]:[],
  };
  test('selects highest newer preview build with uploaded APK', () {
    final selected = AndroidPreviewRelease.newest([
      release('android-preview-v1002'),
      release('android-preview-v1001'),
      release('android-preview-v1007'),
      release('android-preview-v1008',draft:true),
      release('android-preview-v1009',preview:false),
      release('android-preview-v1010',asset:false),
      release('android-preview-v999999999/../../bad'),
    ],1000);
    expect(selected?.code,1007);
    expect(selected?.download.toString(),
      'https://github.com/helalalfqih-sketch/NASQO-PRO-ERP/releases/download/android-preview-v1007/NASQO-PRO-ERP.apk');
  });
  test('no downgrade or reinstall of current version', () {
    expect(AndroidPreviewRelease.newest([release('android-preview-v1000')],1000),isNull);
    expect(AndroidPreviewRelease.newest({},1000),isNull);
  });
}
