{
  "targets": [
    {
      "target_name": "winhelper",
      "conditions": [
        ["OS!=\"win\"", { "type": "none" }],
        ["OS==\"win\"", {
          "sources": ["src/main.cc", "src/shm.cc", "src/uia.cc", "src/stick.cc"],
          "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir.split('\\\\').join('/')\")"],
          "defines": ["NAPI_CPP_EXCEPTIONS", "NAPI_VERSION=8", "UNICODE", "_UNICODE", "NOMINMAX"],
          "libraries": ["-lole32.lib", "-loleaut32.lib", "-luser32.lib", "-luuid.lib", "-ldwmapi.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17", "/utf-8"]
            }
          }
        }]
      ]
    }
  ]
}
