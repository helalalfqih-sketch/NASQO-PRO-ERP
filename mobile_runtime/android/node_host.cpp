#include <jni.h>
#include <node.h>
#include <string>
#include <vector>

extern "C" JNIEXPORT jint JNICALL
Java_com_indexesstore_nasqo_1original_1web_OriginalRuntime_runNode(
    JNIEnv* env, jclass, jstring entry, jstring config) {
  const char* ep=env->GetStringUTFChars(entry,nullptr);
  const char* cp=env->GetStringUTFChars(config,nullptr);
  if(!ep || !cp) {
    if(ep) env->ReleaseStringUTFChars(entry,ep);
    if(cp) env->ReleaseStringUTFChars(config,cp);
    return -1;
  }
  std::vector<std::string> args={"node",ep,cp};
  env->ReleaseStringUTFChars(entry,ep);
  env->ReleaseStringUTFChars(config,cp);
  std::vector<char*> argv;
  for(auto& item:args) argv.push_back(item.data());
  argv.push_back(nullptr);
  return node::Start(static_cast<int>(args.size()),argv.data());
}
