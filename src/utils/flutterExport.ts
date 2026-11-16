export type FlutterProjectFile = {
  path: string;
  label: string;
  language: "yaml" | "dart" | "markdown";
  content: string;
};

export function buildFlutterBundlePayload(files: readonly FlutterProjectFile[]) {
  return {
    projectName: "nasqo_pro_erp",
    framework: "Flutter (Material 3 · RTL Arabic)",
    dartSdkConstraint: ">=3.3.0 <4.0.0",
    exportedAt: new Date().toISOString(),
    fileCount: files.length,
    files: files.map((f) => ({ path: f.path, content: f.content })),
  };
}

export function getFlutterFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || "main.dart";
}
