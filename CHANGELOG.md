## [1.0.0-dev.10](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.9...v1.0.0-dev.10) (2026-08-10)

### ✨ Features

* **toolbar:** add custom button hints ([#107](https://github.com/0x1f320/voxpane/issues/107)) ([3a94fe7](https://github.com/0x1f320/voxpane/commit/3a94fe7bd95a3ff92618e3b0dc1612def0e17054))

## [1.0.0-dev.9](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.8...v1.0.0-dev.9) (2026-08-10)

### ✨ Features

* **effects:** ignore SynthV helper lyrics ([#105](https://github.com/0x1f320/voxpane/issues/105)) ([50a5e2b](https://github.com/0x1f320/voxpane/commit/50a5e2b5d1b1d2c75ed1ec14920332379c8a7bbe))

## [1.0.0-dev.8](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.7...v1.0.0-dev.8) (2026-08-09)

### ✨ Features

* **native:** add SynthV LUFS metering ([#103](https://github.com/0x1f320/voxpane/issues/103)) ([3f73d99](https://github.com/0x1f320/voxpane/commit/3f73d9934bf7d12b74efda4e8041b450262b9e95))

## [1.0.0-dev.7](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.6...v1.0.0-dev.7) (2026-08-09)

### ✨ Features

* **bridge:** stabilize real-time SynthV transport ([#101](https://github.com/0x1f320/voxpane/issues/101)) ([5aede4e](https://github.com/0x1f320/voxpane/commit/5aede4e9218ac13026e6b1e563d8625a6bb550aa))

## [1.0.0-dev.6](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.5...v1.0.0-dev.6) (2026-08-08)

### ⚡ Performance Improvements

* **bridge:** publish scroll transform only on change ([#100](https://github.com/0x1f320/voxpane/issues/100)) ([d78a209](https://github.com/0x1f320/voxpane/commit/d78a209f893ed4c853b9439f27ddeec64076b605))

## [1.0.0-dev.5](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.4...v1.0.0-dev.5) (2026-08-08)

### ✨ Features

* **overlay:** add debug timing diagnostics ([e44e68b](https://github.com/0x1f320/voxpane/commit/e44e68bf61c47390774743911f822c3f8dc7ab27))

## [1.0.0-dev.4](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.3...v1.0.0-dev.4) (2026-08-07)

### ⚡ Performance Improvements

* **bridge:** decouple state sampling from overlay rendering ([#97](https://github.com/0x1f320/voxpane/issues/97)) ([bce50f4](https://github.com/0x1f320/voxpane/commit/bce50f489d71f3b28a3450adba5a02b206560b3f))

## [1.0.0-dev.3](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.2...v1.0.0-dev.3) (2026-08-07)

### 🐛 Bug Fixes

* **bridge:** keep notes generation stable on failed writes ([5cf543e](https://github.com/0x1f320/voxpane/commit/5cf543e748c9afe656cc79bc1f45f078a78e64cc))

## [1.0.0-dev.2](https://github.com/0x1f320/voxpane/compare/v1.0.0-dev.1...v1.0.0-dev.2) (2026-08-07)

### 🐛 Bug Fixes

* **overlay:** reduce scroll latency through bridge geometry ([#94](https://github.com/0x1f320/voxpane/issues/94)) ([1120a34](https://github.com/0x1f320/voxpane/commit/1120a3494f5d6cc919267e7346fbcee77f9bc982))

### ⚡ Performance Improvements

* **bridge:** cache schedules by notes generation ([#95](https://github.com/0x1f320/voxpane/issues/95)) ([3b26a38](https://github.com/0x1f320/voxpane/commit/3b26a38fd56a9d3d72783624b37b8599021b177b))

## 1.0.0-dev.1 (2026-08-05)

### ✨ Features

* **app:** add note effects driven by the SynthV bridge ([#11](https://github.com/0x1f320/voxpane/issues/11)) ([984256c](https://github.com/0x1f320/voxpane/commit/984256c1ccb8a2adbb7445f825a8a28139d94245))
* **app:** frameless window with custom title bar ([#2](https://github.com/0x1f320/voxpane/issues/2)) ([3bae8df](https://github.com/0x1f320/voxpane/commit/3bae8df0ba986fd4dff0931e9bbc11eed4334fb4)), closes [#2D2B2E](https://github.com/0x1f320/voxpane/issues/2D2B2E)
* **app:** narrow frameless floating panel with occlusion ([#7](https://github.com/0x1f320/voxpane/issues/7)) ([ce7e06b](https://github.com/0x1f320/voxpane/commit/ce7e06b3818e6d1d3f7543f426ff39f67da9fc9e))
* **app:** particle spread direction, and an explicit save for effect settings ([#20](https://github.com/0x1f320/voxpane/issues/20)) ([237fdaa](https://github.com/0x1f320/voxpane/commit/237fdaaa2e03856a1dd0b2756f78b19a29d5c8a6))
* **app:** pixel-perfect piano-roll overlay (P2) ([#8](https://github.com/0x1f320/voxpane/issues/8)) ([a618753](https://github.com/0x1f320/voxpane/commit/a618753c24c7a0267cbfbe90d3e5a97949b5922f))
* **app:** restore the sticky toolbar and add a settings window ([#9](https://github.com/0x1f320/voxpane/issues/9)) ([1351ebf](https://github.com/0x1f320/voxpane/commit/1351ebff9ce42865c77fdd9526650b0aa48f3eb5))
* **app:** stick the window to the Synthesizer V window ([#5](https://github.com/0x1f320/voxpane/issues/5)) ([3db6046](https://github.com/0x1f320/voxpane/commit/3db60461bbc67c5f9cc257d497c6daee80e401d3))
* **bridge:** install the bundled bridge script into SynthV on launch ([#76](https://github.com/0x1f320/voxpane/issues/76)) ([e1e5c57](https://github.com/0x1f320/voxpane/commit/e1e5c5765c4b3bcdc8e46575a3e870e8744ae428))
* **bridge:** move the SynthV bridge to Lua and carry it over file channels ([#66](https://github.com/0x1f320/voxpane/issues/66)) ([3e6e688](https://github.com/0x1f320/voxpane/commit/3e6e688464d41cd1cb8ac116419f2ad7ca6391c5)), closes [#61](https://github.com/0x1f320/voxpane/issues/61)
* **effects:** carry the highlight's flash on as a jitter ([#23](https://github.com/0x1f320/voxpane/issues/23)) ([7d446b1](https://github.com/0x1f320/voxpane/commit/7d446b10e844dc87343c0470873386f286f141c6))
* **effects:** draw the glow and particles with an imported image ([#62](https://github.com/0x1f320/voxpane/issues/62)) ([145cf0a](https://github.com/0x1f320/voxpane/commit/145cf0ab8e56b740bebfa4caa5ce7958f04086ab))
* **effects:** drive note effects from the sung pitch ([#63](https://github.com/0x1f320/voxpane/issues/63)) ([74f7e9b](https://github.com/0x1f320/voxpane/commit/74f7e9b260b03d5fdfc561197dc84690ba6d009a))
* **effects:** keep note effect settings as named presets ([#24](https://github.com/0x1f320/voxpane/issues/24)) ([f97d433](https://github.com/0x1f320/voxpane/commit/f97d4337b28c496e50319b93d31bd1401554cd14))
* **effects:** leave a glowing trail along the sung pitch ([#67](https://github.com/0x1f320/voxpane/issues/67)) ([2531335](https://github.com/0x1f320/voxpane/commit/25313355d752ba4c7124e8c65636de61e8643ddf))
* **effects:** let the highlight take a cross, X or star shape ([#28](https://github.com/0x1f320/voxpane/issues/28)) ([6f48e0f](https://github.com/0x1f320/voxpane/commit/6f48e0f959ec7ee09761b733d63ddc7b8b68b131))
* **effects:** preview the effects on a three-note staircase ([#22](https://github.com/0x1f320/voxpane/issues/22)) ([2ed98ca](https://github.com/0x1f320/voxpane/commit/2ed98ca21affec637d7142ac78fa9b2b8932a099))
* **settings:** center the settings window on the toolbar's display ([#30](https://github.com/0x1f320/voxpane/issues/30)) ([09391ca](https://github.com/0x1f320/voxpane/commit/09391caf1971fc54d63f449e388e05c7b06d66d7))
* **settings:** draw the settings window's title bar on Windows ([#60](https://github.com/0x1f320/voxpane/issues/60)) ([e916141](https://github.com/0x1f320/voxpane/commit/e9161417d96c021eaa3b940c397cf0e80aad1c05)), closes [#59](https://github.com/0x1f320/voxpane/issues/59)
* **settings:** follow the sung pitch in the effect preview ([#69](https://github.com/0x1f320/voxpane/issues/69)) ([f2b584e](https://github.com/0x1f320/voxpane/commit/f2b584ef3dcb7db1afdfb3a7d463d3977f2816ff)), closes [#68](https://github.com/0x1f320/voxpane/issues/68)
* **settings:** localize the app into ko, en and ja ([#58](https://github.com/0x1f320/voxpane/issues/58)) ([cfee00f](https://github.com/0x1f320/voxpane/commit/cfee00f104089b209fec8495b943a3e81893a1bd)), closes [#39](https://github.com/0x1f320/voxpane/issues/39)
* **settings:** pick colours in an in-app picker ([#27](https://github.com/0x1f320/voxpane/issues/27)) ([36147f8](https://github.com/0x1f320/voxpane/commit/36147f82a8482c06058dfbf96897c2317b4a2ae0))
* **settings:** rebuild the UI primitives on Radix and redesign the slider ([#26](https://github.com/0x1f320/voxpane/issues/26)) ([d582779](https://github.com/0x1f320/voxpane/commit/d582779466376f1aaa701a3e4af5da35927d80ae))
* **shell:** add a menu bar / tray item with settings, effects and quit ([#54](https://github.com/0x1f320/voxpane/issues/54)) ([d93d5ea](https://github.com/0x1f320/voxpane/commit/d93d5eaff89e6684ddec82c6169c08084872d4e5))
* **shell:** allow only a single running instance ([#21](https://github.com/0x1f320/voxpane/issues/21)) ([0ae61e8](https://github.com/0x1f320/voxpane/commit/0ae61e8d4cdef7b57165f540782596a150ca6fb9))
* **shell:** gate the app start behind a macOS permissions onboarding ([#55](https://github.com/0x1f320/voxpane/issues/55)) ([6e919f5](https://github.com/0x1f320/voxpane/commit/6e919f53707022adc92dd4d31b4fa73398d54e58))
* **shell:** package the app with electron-builder ([#86](https://github.com/0x1f320/voxpane/issues/86)) ([f29d99a](https://github.com/0x1f320/voxpane/commit/f29d99a8099b460231212aa954a446ad04caadc4)), closes [#45](https://github.com/0x1f320/voxpane/issues/45)
* **shell:** rename the user-facing app to KaraokeV ([#56](https://github.com/0x1f320/voxpane/issues/56)) ([f66061d](https://github.com/0x1f320/voxpane/commit/f66061d86d2649a73a1d753b5b0f7afb009926c6)), closes [#51](https://github.com/0x1f320/voxpane/issues/51)
* **shell:** support Windows ([#31](https://github.com/0x1f320/voxpane/issues/31)) ([ef5f0a8](https://github.com/0x1f320/voxpane/commit/ef5f0a8400cdd07cf85695e7352178c770028bfd))
* **toolbar:** add a quit button to the toolbar ([#82](https://github.com/0x1f320/voxpane/issues/82)) ([f87a7a8](https://github.com/0x1f320/voxpane/commit/f87a7a8da11df1dd5c6ad53584fd67f7218797bf))
* **toolbar:** round the toolbar panel and drop its title bar ([#72](https://github.com/0x1f320/voxpane/issues/72)) ([d22a042](https://github.com/0x1f320/voxpane/commit/d22a0427006735ad43c539ee9f210877fa3351a3))
* **toolbar:** size the toolbar window to its content ([#80](https://github.com/0x1f320/voxpane/issues/80)) ([d897469](https://github.com/0x1f320/voxpane/commit/d89746958c284a32151aa7d55f69cb52a59d4cdd)), closes [#79](https://github.com/0x1f320/voxpane/issues/79)
* **toolbar:** toggle the note effects from the toolbar ([#29](https://github.com/0x1f320/voxpane/issues/29)) ([a4c7fd8](https://github.com/0x1f320/voxpane/commit/a4c7fd807e4738bbbf75de07ff64f9f201769a98))

### 🐛 Bug Fixes

* **app:** keep the overlay aligned through horizontal scroll and zoom ([#15](https://github.com/0x1f320/voxpane/issues/15)) ([1516a71](https://github.com/0x1f320/voxpane/commit/1516a7159f8bf7df6bfa7ef1303670e6383427f6))
* **app:** keep the overlay drawable across an HMR reload ([#16](https://github.com/0x1f320/voxpane/issues/16)) ([eb2f228](https://github.com/0x1f320/voxpane/commit/eb2f228adff608f4cb6b1804c7793aabb64d8221))
* **bridge:** publish the view transform at the full tick rate while stopped ([#77](https://github.com/0x1f320/voxpane/issues/77)) ([ce5866f](https://github.com/0x1f320/voxpane/commit/ce5866f38d3fb47345b36fa3f48d0e9a7710fa09)), closes [#75](https://github.com/0x1f320/voxpane/issues/75)
* **effects:** keep the trail on the sung pitch with following off ([#71](https://github.com/0x1f320/voxpane/issues/71)) ([93f0a01](https://github.com/0x1f320/voxpane/commit/93f0a018cf009c26f19f8a86337d396f4a027652)), closes [#70](https://github.com/0x1f320/voxpane/issues/70)
* **effects:** let in-flight effects finish after playback stops ([#19](https://github.com/0x1f320/voxpane/issues/19)) ([686bb7c](https://github.com/0x1f320/voxpane/commit/686bb7c842fca1eea321b93343a1d3b3f193ae1b))
* **macos-helper:** detect notes at the top of the piano roll ([#17](https://github.com/0x1f320/voxpane/issues/17)) ([2d10405](https://github.com/0x1f320/voxpane/commit/2d104058f6ce80a90bc5f7a5d304dda309907a46))
* **macos-helper:** find the content group when the note group is mid-view ([#12](https://github.com/0x1f320/voxpane/issues/12)) ([ab5824d](https://github.com/0x1f320/voxpane/commit/ab5824d52aed66cee1c9d423df5f34237c5077dc))
* **project:** generate release changelogs ([852c6bd](https://github.com/0x1f320/voxpane/commit/852c6bd8937bf02f99a0ac855c045fc386a5f611))

### ⚡ Performance Improvements

* **app:** render the note overlay with PixiJS ([#10](https://github.com/0x1f320/voxpane/issues/10)) ([90bf190](https://github.com/0x1f320/voxpane/commit/90bf1903959e3fbb186cc004cdb6e1f310ac25d2))

### ♻️ Code Refactoring

* **native:** rewrite both native addons in Rust with napi-rs ([#73](https://github.com/0x1f320/voxpane/issues/73)) ([a1fd97b](https://github.com/0x1f320/voxpane/commit/a1fd97bbcb8f6c442257d1ad1696e322def8e5ff)), closes [#41](https://github.com/0x1f320/voxpane/issues/41)
