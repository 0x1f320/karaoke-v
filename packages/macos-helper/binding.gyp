{
  "targets": [
    {
      "target_name": "stick",
      "conditions": [
        ["OS!=\"mac\"", { "type": "none" }],
        ["OS==\"mac\"", {
          "sources": ["src/stick.mm", "src/pianoroll.mm"],
          "include_dirs": ["<!@(node -p \"require('node-addon-api').include_dir\")"],
          "defines": ["NAPI_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_LDFLAGS": [
              "-framework AppKit",
              "-framework ApplicationServices",
              "-framework CoreGraphics",
              "-framework Foundation"
            ]
          }
        }]
      ]
    }
  ]
}
