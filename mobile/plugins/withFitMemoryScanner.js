const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const packageName = "com.mfurkangokbag.fitmemory.scanner";
const appPackageName = "com.mfurkangokbag.fitmemory";

const packageSource = `package ${packageName}

import android.content.Intent
import android.graphics.BitmapFactory
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import android.util.Base64

class FitMemoryScannerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "FitMemoryScanner"

  @ReactMethod
  fun recognizeBase64(value: String, promise: Promise) {
    try {
      val payload = value.substringAfter("base64,", value)
      val bytes = Base64.decode(payload, Base64.DEFAULT)
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("OCR görüntüsü çözülemedi")
      val image = InputImage.fromBitmap(bitmap, 0)
      TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        .process(image)
        .addOnSuccessListener { result ->
          val response = Arguments.createMap()
          response.putString("text", result.text)
          val lines = Arguments.createArray()
          result.textBlocks.forEach { block ->
            block.lines.forEach { line ->
              val item = Arguments.createMap()
              item.putString("text", line.text)
              line.boundingBox?.let { box ->
                item.putInt("left", box.left)
                item.putInt("top", box.top)
                item.putInt("right", box.right)
                item.putInt("bottom", box.bottom)
              }
              lines.pushMap(item)
            }
          }
          response.putArray("lines", lines)
          promise.resolve(response)
        }
        .addOnFailureListener { promise.reject("OCR_FAILED", it.message, it) }
    } catch (error: Throwable) {
      promise.reject("OCR_INVALID_IMAGE", error.message, error)
    }
  }

  @ReactMethod
  fun accessibilitySnapshot(promise: Promise) {
    val response: WritableMap = Arguments.createMap()
    response.putBoolean("enabled", isAccessibilityEnabled())
    response.putString("text", FitMemoryAccessibilityService.latestSnapshot)
    promise.resolve(response)
  }

  @ReactMethod
  fun openMeasurementPanel(promise: Promise) {
    promise.resolve(FitMemoryAccessibilityService.clickMeasurementFlow())
  }

  @ReactMethod
  fun sizeOptions(promise: Promise) {
    val values = Arguments.createArray()
    FitMemoryAccessibilityService.sizeOptions().forEach(values::pushString)
    promise.resolve(values)
  }

  @ReactMethod
  fun selectSize(value: String, promise: Promise) {
    promise.resolve(FitMemoryAccessibilityService.selectSize(value))
  }

  @ReactMethod
  fun openAccessibilitySettings() {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }

  private fun isAccessibilityEnabled(): Boolean {
    val expected = "\${context.packageName}/\${FitMemoryAccessibilityService::class.java.name}"
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    return enabled.split(':').any { TextUtils.equals(it, expected) }
  }
}

class FitMemoryScannerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(FitMemoryScannerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

const serviceSource = `package ${packageName}

import android.accessibilityservice.AccessibilityService
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class FitMemoryAccessibilityService : AccessibilityService() {
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.packageName?.toString() != "${appPackageName}") return
    latestSnapshot = collect(rootInActiveWindow).take(24000)
    activeService = this
  }

  override fun onInterrupt() = Unit

  override fun onServiceConnected() {
    activeService = this
    super.onServiceConnected()
  }

  override fun onDestroy() {
    if (activeService === this) activeService = null
    super.onDestroy()
  }

  private fun collect(root: AccessibilityNodeInfo?): String {
    if (root == null) return ""
    val output = ArrayList<String>()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    while (queue.isNotEmpty() && output.size < 1200) {
      val node = queue.removeFirst()
      val value = listOfNotNull(node.text, node.contentDescription)
        .map { it.toString().replace(Regex("\\s+"), " ").trim() }
        .filter { it.isNotBlank() }
        .distinct()
        .joinToString(" ")
      if (value.isNotBlank()) {
        output.add(if (node.isSelected || node.isChecked) "[selected] $value" else value)
      }
      for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
    }
    return output.distinct().joinToString("\n")
  }

  companion object {
    @Volatile var latestSnapshot: String = ""
    @Volatile private var activeService: FitMemoryAccessibilityService? = null

    fun clickMeasurementFlow(): Boolean {
      val service = activeService ?: return false
      val root = service.rootInActiveWindow ?: return false
      val measure = findClickable(root, Regex("ölçüleri? (gör|görüntüle|göster)|beden tablosu|beden rehberi|measurements?|size guide", RegexOption.IGNORE_CASE))
      if (measure != null) return measure.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      val add = findClickable(root, Regex("^(ekle|sepete ekle|sepete ekleyin|add|add to bag|choose size|select size|beden seç)$", RegexOption.IGNORE_CASE))
      if (add?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) {
        SystemClock.sleep(450)
        val refreshed = service.rootInActiveWindow ?: return true
        findClickable(refreshed, Regex("ölçüleri? (gör|görüntüle|göster)|beden tablosu|beden rehberi|measurements?|size guide", RegexOption.IGNORE_CASE))
          ?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return true
      }
      return false
    }

    fun sizeOptions(): List<String> {
      val service = activeService ?: return emptyList()
      val root = service.rootInActiveWindow ?: return emptyList()
      val pattern = Regex("^(XXXL|XXL|XL|L|M|S|XS|XXS|XXXS|[2-5][0-9])(?:\\s*\\([^)]*\\))?$", RegexOption.IGNORE_CASE)
      val output = linkedSetOf<String>()
      val queue = ArrayDeque<AccessibilityNodeInfo>()
      queue.add(root)
      while (queue.isNotEmpty() && output.size < 16) {
        val node = queue.removeFirst()
        val value = node.text?.toString()?.trim().orEmpty()
        pattern.matchEntire(value)?.groupValues?.getOrNull(1)?.uppercase()?.let(output::add)
        for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
      }
      return output.toList()
    }

    fun selectSize(value: String): Boolean {
      val service = activeService ?: return false
      val root = service.rootInActiveWindow ?: return false
      val escaped = Regex.escape(value.trim())
      return findClickable(root, Regex("^$escaped(?:\\s*\\([^)]*\\))?$", RegexOption.IGNORE_CASE))
        ?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    private fun findClickable(root: AccessibilityNodeInfo, pattern: Regex): AccessibilityNodeInfo? {
      val queue = ArrayDeque<AccessibilityNodeInfo>()
      queue.add(root)
      while (queue.isNotEmpty()) {
        val node = queue.removeFirst()
        val value = listOfNotNull(node.text, node.contentDescription).joinToString(" ").trim()
        if (pattern.containsMatchIn(value)) {
          var target: AccessibilityNodeInfo? = node
          repeat(5) {
            if (target?.isClickable == true) return target
            target = target?.parent
          }
        }
        for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
      }
      return null
    }
  }
}
`;

const accessibilityXml = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
  android:accessibilityEventTypes="typeWindowContentChanged|typeWindowStateChanged|typeViewClicked|typeViewScrolled"
  android:accessibilityFeedbackType="feedbackGeneric"
  android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews"
  android:canRetrieveWindowContent="true"
  android:description="@string/fitmemory_scanner_accessibility_description"
  android:packageNames="com.mfurkangokbag.fitmemory"
  android:notificationTimeout="80" />
`;

const iosScannerSource = `import Foundation
import React
import UIKit
import Vision

@objc(FitMemoryScanner)
final class FitMemoryScanner: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(recognizeBase64:resolver:rejecter:)
  func recognizeBase64(
    _ value: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let payload = value.components(separatedBy: "base64,").last ?? value
    guard let data = Data(base64Encoded: payload),
          let image = UIImage(data: data),
          let cgImage = image.cgImage else {
      reject("OCR_INVALID_IMAGE", "OCR görüntüsü çözülemedi", nil)
      return
    }
    let request = VNRecognizeTextRequest { request, error in
      if let error = error {
        reject("OCR_FAILED", error.localizedDescription, error)
        return
      }
      let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
      let lines: [[String: Any]] = observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return [
          "text": candidate.string,
          "left": Int(box.minX * 1000),
          "top": Int((1 - box.maxY) * 1000),
          "right": Int(box.maxX * 1000),
          "bottom": Int((1 - box.minY) * 1000),
        ]
      }
      resolve(["text": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"), "lines": lines])
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["tr-TR", "en-US"]
    DispatchQueue.global(qos: .userInitiated).async {
      do { try VNImageRequestHandler(cgImage: cgImage).perform([request]) }
      catch { reject("OCR_FAILED", error.localizedDescription, error) }
    }
  }

  @objc(accessibilitySnapshot:rejecter:)
  func accessibilitySnapshot(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) { resolve(["enabled": false, "text": ""]) }

  @objc(openMeasurementPanel:rejecter:)
  func openMeasurementPanel(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) { resolve(false) }

  @objc(sizeOptions:rejecter:)
  func sizeOptions(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) { resolve([]) }

  @objc(selectSize:resolver:rejecter:)
  func selectSize(
    _ value: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) { resolve(false) }

  @objc func openAccessibilitySettings() {}
}
`;

const iosBridgeSource = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(FitMemoryScanner, NSObject)
RCT_EXTERN_METHOD(recognizeBase64:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(accessibilitySnapshot:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openMeasurementPanel:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(sizeOptions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(selectSize:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openAccessibilitySettings)
@end
`;

module.exports = function withFitMemoryScanner(config) {
  config = withAppBuildGradle(config, (next) => {
    if (!next.modResults.contents.includes("com.google.mlkit:text-recognition")) {
      next.modResults.contents = next.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.google.mlkit:text-recognition:16.0.1")',
      );
    }
    return next;
  });

  config = withAndroidManifest(config, (next) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    app.service = app.service || [];
    if (!app.service.some((item) => item.$?.["android:name"] === `${packageName}.FitMemoryAccessibilityService`)) {
      app.service.push({
        $: {
          "android:name": `${packageName}.FitMemoryAccessibilityService`,
          "android:exported": "true",
          "android:label": "FitMemory beden tablosu okuyucu",
          "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
        },
        "intent-filter": [{ action: [{ $: { "android:name": "android.accessibilityservice.AccessibilityService" } }] }],
        "meta-data": [{ $: { "android:name": "android.accessibilityservice", "android:resource": "@xml/fitmemory_accessibility_service" } }],
      });
    }
    return next;
  });

  config = withMainApplication(config, (next) => {
    let source = next.modResults.contents;
    const importLine = `import ${packageName}.FitMemoryScannerPackage`;
    if (!source.includes(importLine)) source = source.replace(/(package [^\n]+\n)/, `$1\n${importLine}\n`);
    if (!source.includes("add(FitMemoryScannerPackage())")) {
      source = source.replace(/PackageList\(this\)\.packages\.apply\s*\{/, "PackageList(this).packages.apply {\n              add(FitMemoryScannerPackage())");
    }
    next.modResults.contents = source;
    return next;
  });

  config = withDangerousMod(config, ["android", async (next) => {
    const project = next.modRequest.platformProjectRoot;
    const javaDir = path.join(project, "app", "src", "main", "java", ...packageName.split("."));
    const xmlDir = path.join(project, "app", "src", "main", "res", "xml");
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.writeFileSync(path.join(javaDir, "FitMemoryScannerPackage.kt"), packageSource);
    fs.writeFileSync(path.join(javaDir, "FitMemoryAccessibilityService.kt"), serviceSource);
    fs.writeFileSync(path.join(xmlDir, "fitmemory_accessibility_service.xml"), accessibilityXml);
    const stringsPath = path.join(project, "app", "src", "main", "res", "values", "strings.xml");
    let strings = fs.readFileSync(stringsPath, "utf8");
    if (!strings.includes("fitmemory_scanner_accessibility_description")) {
      strings = strings.replace("</resources>", "  <string name=\"fitmemory_scanner_accessibility_description\">FitMemory uygulama içi mağaza sayfalarındaki beden tablosunu okur.</string>\n</resources>");
      fs.writeFileSync(stringsPath, strings);
    }
    return next;
  }]);
  config = withXcodeProject(config, (next) => {
    const iosRoot = next.modRequest.platformProjectRoot;
    const projectName = next.modRequest.projectName;
    const sourceRoot = path.join(iosRoot, projectName);
    fs.mkdirSync(sourceRoot, { recursive: true });
    const swiftName = "FitMemoryScanner.swift";
    const bridgeName = "FitMemoryScannerBridge.m";
    fs.writeFileSync(path.join(sourceRoot, swiftName), iosScannerSource);
    fs.writeFileSync(path.join(sourceRoot, bridgeName), iosBridgeSource);
    const serialized = JSON.stringify(next.modResults.hash.project);
    if (!serialized.includes(swiftName)) next.modResults.addSourceFile(`${projectName}/${swiftName}`);
    if (!serialized.includes(bridgeName)) next.modResults.addSourceFile(`${projectName}/${bridgeName}`);
    return next;
  });
  return config;
};
