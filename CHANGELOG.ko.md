<!-- doc-id: changelog -->
<!-- source-sha256: 4917947b66d155c221c96875e31be0cf5143a9c46b4d8b5132116cfb0f9422f9 -->
# 변경 기록

[English](CHANGELOG.md)

## Unreleased

- parity의 php binding은 run-tests와 lint-php처럼 그 package에 Composer가 주는 vendor directory의 PHPUnit을 실행합니다(composer-vendor.mts): package 자신의 것, 또는 그 위의 가장 가까운 Composer project의 것입니다. root composer.json이 path repository로 library를 require하고 root에 `vendor/` 하나를 설치하는 Composer monorepo(K163)는 모든 php binding을 "`<package>/vendor/bin/phpunit` does not exist"와 함께 R3 not-executed로 보고했습니다; 이제 그것을 실행하며, 위로 vendor directory가 없는 package는 여전히 해결 방법과 함께 실패합니다(K178).
- kit-check의 recipe-tools 검사(K171)는 POSIX shell의 quoting 규칙으로 recipe line을 나눕니다: quote된 문자열은 한 word이고, quote 안의 `|`, `;`, `&&`는 operator가 아닙니다. `@echo "build-ts|go|…"` 같은 help line은 go를 bare name으로 시작한다고 보고되어 문구를 바꿔야 했습니다; 이제 통과하며, `foo | node x`는 여전히 실패합니다(K179).
- composer.json의 version을 정하는 릴리스는 그 directory에서 `composer update --lock`으로 다시 lock합니다: `composer.lock`의 content-hash가 `version`을 포함하므로 version 변경만으로는 낡은 lock이 남고, `make dependency-policy-check`가 그것을 실패시킵니다(`composerLock`). AGENTS.md와 docs/tool-inventory.md의 릴리스 절차가 이를 말하며, `make dependency-policy-mutation-check`는 새 lock 없는 version 변경이라는 mutation을 얻고 gate는 그것을 거부해야 합니다(K180).
- make dependency-policy-check가 checkout의 모든 Composer manifest를 검사합니다: `composerPlatforms`가 지정하지 않고, 그것이 지정한 manifest의 path repository가 제공하지도(K168) 않는 추적된 composer.json은 rule `composerCoverage`로 실패합니다. 이전에는 Composer platform을 하나도 적지 않은 저장소가 어떤 manifest에도 `composer validate --strict`를 실행하지 않았으므로, version 변경이 낡게 만든 lock이 release를 지나도록 낡은 채 남았습니다. kit이 쓰는 manifest, kit이 배포하는 symbol extractor project, `config/release.json`의 Composer consumer project는 검사하지 않습니다(K181).
- `config/owner-checks.json`이 `ciExempt`를 받습니다: 저장소의 CI workflow가 실행하지 않는 owner rule의 make target과 각각의 이유입니다. kit의 CI workflow test는 다른 모든 owner target에 step을 요구합니다; kit의 CI는 이제 실패가 local 실행까지 숨어 있던 make toolchain-check, kit-check, release-coverage를 실행하고, make install-hooks가 쓰는 local core.hooksPath가 필요한 hooks-check를 면제합니다(K183).
- kit-check의 recipe-tools 검사는 자체 splitter(K179) 대신 kit의 새 dependency인 shell-quote 1.12.0의 `parse`로 recipe line을 shell word로 나눕니다; kit의 모든 recipe와 기존 case의 word는 같고, `$(if $(RANGE),--range $(RANGE))` 같은 중첩된 make function은 더 이상 엉뚱한 command `if`를 내지 않습니다(K184).

### 소비자 이전

make dependency-policy-check가 `composerCoverage`로 보고하는 각 composer.json은 `config/dependency-policy.json`의 `composerPlatforms`에 `{ "manifest": "<path>", "php": "<최소 PHP>" }` 항목을 얻고, manifest의 `config.platform.php`를 그 PHP로 두며, `composer update --lock`이 쓴 lock과 `make dependency-review RECORD=1`(ONLINE)을 더합니다; Composer monorepo의 published package는 대신 root의 path repository로 require합니다(K181). composer.json의 version을 정하는 릴리스는 `make dependency-review RECORD=1` 전에 그 directory에서 `composer update --lock`을 실행합니다(K180).

## 0.0.49

- `config/knip-entries.json`의 `ignore`는 저장소의 code가 아닌 파일을 선언하며, knip도 oxlint도 그 파일을 읽지 않습니다: make lint-ts는 각 glob을 knip의 `ignore`에 더할 뿐 아니라 kit 사본처럼 oxlint에 `--ignore-pattern`으로 줍니다. 일부러 깨뜨린 build 도구 test의 입력 같은 파일이 더는 풀 수 없는 import로 oxlint의 type-aware rule에서 실패하지 않으며, 선언한 glob 밖의 같은 위반은 여전히 실패합니다(K172).
- make install-vscode가 내려받기 뒤에 끝납니다. `@vscode/test-electron` 3.1.0은 실패한 내려받기 시도("aborted")의 `tar -xzf -` child를 살려 두었으므로, 재시도가 성공한 뒤에도 install이 CI job의 timeout까지 멈춰 있었습니다. install은 내려받기를 자기 process에서 돌리고, 내려받기가 끝나면 그 process group을 죽입니다. 모든 시도가 실패한 내려받기는 `@vscode/test-electron`의 오류로 install을 실패시킵니다(K173).
- 자기 package의 build 출력(`../dist/…`)을 import하는 test는 `tsconfig.json`이 build project를 참조하면 knip에서 source의 사용으로 셉니다. knip은 TypeScript project reference를 따르고 knip의 `paths`는 이미 있는 dist에 닿지 않으므로 kit은 option을 더하지 않습니다(K175).
- make toolchain-lock이 checkout의 node가 생기기 전에 돕니다. 0.0.48에서는 bootstrap이 `mise.lock`이 고정한 node로 설치하는 `var/tools/bin/node`로 돌았으므로, `mise.lock`이 아직 node를 고정하지 않은 저장소는 lock도 bootstrap도 할 수 없었습니다. 이제 machine의 node(`$(BOOTSTRAP_NODE)`)가 그것을 시작하며, bootstrap처럼 `config/toolchain.json`의 mise를 스스로 설치합니다(K174).
- knip이 복사된 `knip.json`에 대한 configuration hint를 출력하지 않습니다(K176). make lint-ts는 knip.json의 각 `ignoreDependencies` 항목(`@polyspec/kit`, oxlint, oxlint-tsgolint, jscpd)을 저장소의 package.json(root나 `config/knip-entries.json`의 workspace)이 선언할 때만 남기며, knip.json에는 더는 `ignoreBinaries`가 없습니다: kit의 어떤 사본도 knip이 보고하는 binary를 실행하지 않고, node, git, python3, cargo는 knip의 global binary입니다. knip은 언제나 `var/lint-ts/knip.json`을 읽습니다.
- dependency review가 `pythonManifests`의 각 pyproject.toml에서 `build-system.requires`와 extra뿐 아니라 `[dependency-groups]`(PEP 735)의 group도 읽으며, 각 `{ include-group }`은 PEP 735대로 풉니다; dependency group만 선언한 requirement(test 전용 등)는 review를 벗어났습니다. `make dependency-review UPDATE=1`은 이미 그것을 고정했고, 이제 review와 pin-python-dependency는 한 module로 그 array를 읽습니다(K177).

### 소비자 이전

`make kit-sync`를 실행합니다. 그것은 `ignoreBinaries`가 없는 `knip.json`을 씁니다(K176). 그다음 make lint-ts가 unlisted binary로 보고하는 각 binary(저장소의 script나 test가 실행하는 make, go, php, composer, rustup, shasum 등)를 이유와 함께 `config/knip-entries.json`의 `binaries`에 넣습니다(K176).

`pythonManifests`의 pyproject.toml은 extra처럼 dependency group의 각 requirement도 정확히 고정하고(`name==version`), include-group은 그 파일의 group을 가리킵니다; 그다음 `make dependency-review`가 그것을 기록하며, 그때까지 gate는 실패합니다(K177).

oxlint가 보고한 파일 중 저장소의 code가 아닌 것은 disable 주석이나 oxlint의 ignore 대신 이유와 함께 `config/knip-entries.json`의 `ignore`에 넣습니다(K172). VS Code를 설치하는 저장소는 kit 갱신과 함께 make install-vscode의 수정을 받으며, 설정에서 바꿀 것은 없습니다(K173). test가 자기 `dist`를 import하고 knip이 export를 unused로 보고하는 package는 build를 `outDir`, `rootDir: src`, `composite: true`를 둔 자기 tsconfig에 두고, test를 유지하는 `tsconfig.json`의 `references`에 그것을 적습니다. 설정은 `docs/tool-inventory.ko.md`에 있습니다(K175).

`mise.lock`이 node를 고정하지 않은 저장소(0.0.47에서 옮겨 오는 저장소 등)는 다음 순서로 실행합니다(K174):
1. 이 kit을 설치하는 `make install-packages`.
2. 0.0.48의 안내대로 `mise.toml`에 node를 선언한 뒤, `mise.lock`에 node를 쓰는 `make toolchain-lock`.
3. mise, 그 node, npm을 var/tools에 설치하는 `make install-tools TOOLS=npm`.
4. checkout의 node로 도는 `make kit-sync`와 `make install-tools`.

## 0.0.48

- 복사되는 `.github/workflows/release.yml`이 actions/checkout v7.0.1, actions/setup-node v7.1.0, shivammathur/setup-php 2.40.0을 각 release의 전체 SHA로 고정합니다. setup-php는 움직이는 tag v2의 SHA로 고정되어 있었습니다. 두 major는 workflow가 넘기는 input을 하나도 바꾸지 않습니다(K169).
- 각 checkout이 자기 Node.js를 실행합니다(K171). `node`는 kit pin에 맞춘 `mise.toml`의 도구이고 `mise.lock`이 platform별 archive를 고정합니다. `.node-version`은 없어졌고 kit의 layout도 더는 허용하지 않습니다. `make install-tools TOOLS=npm`은 machine의 어떤 node로든 시작하며 `config/toolchain.json`의 mise를, 그것으로 `mise.toml`의 node를, 그다음 `packageManager`의 npm을 설치합니다. `var/tools/bin/node`는 그 node를 절대 경로로 실행하고 npm과 npx wrapper는 그 node로 npm을 실행하므로, `npm ci`와 이후 모든 단계가 checkout의 node로 실행됩니다. bootstrap은 더는 실행 중인 node를 선언과 비교하지 않습니다. `make toolchain-check`는 `var/tools/bin/node`를 실행하고 고칠 방법으로 `make install-tools TOOLS=npm`을 알립니다. `config/toolchain.json`은 더는 `node`를 받지 않습니다.
- kit.mk는 checkout의 각 도구를 절대 경로로 실행합니다: `$(NODE)`(`var/tools/bin/node`), `$(NPM)`, `$(ALINT)`; `$(BOOTSTRAP_NODE)`는 bootstrap만 시작하는 machine의 node입니다. macOS의 make인 make 3.81은 shell 문법이 없는 recipe 줄을 kit.mk가 export한 PATH가 아니라 make가 시작할 때의 PATH에서 찾으므로, Mac에서는 모든 `node $(KIT)/…` recipe가 machine의 node를 실행했습니다. `make kit-check`는 checkout의 도구(var/tools/bin의 wrapper나 `mise.toml`의 command)를 이름만으로 실행하는 Makefile의 recipe를 실패시킵니다(K171).

- kit이 Node.js 26.12.0(최신 release)을 고정합니다(`scripts/kit/toolchain-pins.json`): `mise.toml`의 `node`는 그 release여야 하고 모든 `package.json`의 `engines.node`는 `>=26.12.0`이어야 합니다. 각 checkout은 이 kit을 받을 때 그것을 var/tools에 설치하므로 어떤 machine의 node도 바뀌지 않습니다(K169, K171).

### 소비자 이전

실행:
- `.github/workflows/release.yml`(K169, K171)과 `scripts/kit/bootstrap`, `scripts/kit/kit-bootstrap.mk`의 copy(K171)를 쓰는 `make kit-sync`.
- 아래 변경 뒤 `make toolchain-lock`, 그다음 `make install-tools TOOLS=npm`과 `make install-tools`(K171).

변경:
- Node.js release를 `.node-version`에서 `mise.toml`의 `[tools]`에 있는 `node = "26.12.0"`으로 옮기고, 모든 `package.json`의 `engines.node`를 `>=26.12.0`으로 하며, `.node-version`을 지웁니다. CI의 setup-node는 `node-version-file: mise.toml`을 읽습니다(K171).
- `config/toolchain.json`에서 `node`를, 그것을 읽던 저장소의 download와 함께 지웁니다. node는 mise가 설치합니다(K171).
- Makefile의 recipe에서 checkout의 각 도구를 이름만으로가 아니라 kit.mk의 변수(`$(NODE)`, `$(NPM)`, `$(ALINT)`)나 `$(CURDIR)/…`의 절대 경로로 실행합니다. `make kit-check`가 그런 줄을 하나하나 알립니다(K171).

## 0.0.47

- 복사되는 `.oxlintrc.json`이 non-null assertion을 error로 실패시킵니다(`typescript/no-non-null-assertion`): `noUncheckedIndexedAccess` 아래의 list 항목이나 정규식 group처럼 type이 undefined나 null을 허용하는 값은 검사로 읽습니다. kit은 그런 값을 기대한 식을 밝히며 던지는 `scripts/kit/present.mts`의 `present`로, test는 assert하는 `tests/kit/known.mts`의 `known`으로 읽습니다(K156).
- 복사되는 `.oxlintrc.json`의 type-aware rule은 typescript-eslint의 `disableTypeChecked`가 JavaScript에서 끄는 것처럼 TypeScript 파일(`**/*.{ts,mts,cts,tsx}`, oxlint `overrides` 항목)에만 적용됩니다: `no-unsafe-*` rule, `no-unnecessary-type-assertion`, `no-floating-promises`, correctness category의 type-aware rule입니다. 일반 .js나 .mjs 파일에서는 type이 없는 parameter가 모두 `any`이므로 0.0.46은 그 파일이 JavaScript라는 뜻뿐인 finding을 수천 개 보고했습니다. `ban-ts-comment`, `no-explicit-any`, `no-non-null-assertion`과 나머지 correctness는 여전히 모든 파일에 적용됩니다(K170).

### 소비자 이전

실행:
- `.oxlintrc.json`을 쓰는 `make kit-sync`(K156, K170).

수정:
- 0.0.46이 보고한 JavaScript 파일에는 할 일이 없습니다: make kit-sync 뒤에는 type-aware rule이 그 파일을 읽지 않으며, TypeScript 파일은 전과 같이 lint됩니다(K170).
- `make lint-ts`가 이제 보고하는 `!` 하나하나를 disable 없이: 값을 구조 분해해 검사하거나, 기대하는 것을 밝히는 레포의 throwing accessor로 읽습니다(K156).

## 0.0.46

- 복사되는 `.oxlintrc.json`이 TypeScript type의 비상구를 error로 금지합니다: `typescript/ban-ts-comment`는 `@ts-ignore`와 `@ts-nocheck`를 금지하고 `@ts-expect-error` 뒤에 설명(`// @ts-expect-error: <이유>`)을 요구하며, `typescript/no-explicit-any`와 `typescript/no-unnecessary-type-assertion`은 명시적 `any`와 아무것도 바꾸지 않는 type assertion을 실패시킵니다. 한 레포가 type 검사를 통과하는 code에 `@ts-expect-error`를 달고 cast로 tsc를 잠재웠습니다. 사본 `scripts/kit/bootstrap/files.mts`의 `readJson`은 `any` 대신 `unknown`을 돌려줍니다(K155).
- consumer에서 `make lint-ts`는 kit의 사본을 oxlint에서 뺍니다: 설치된 package의 `kit.copies`, 곧 make kit-sync가 쓰고 make kit-check가 byte 단위로 비교하는 기록의 각 파일마다 `--ignore-pattern` 하나입니다. kit은 자기 사본을 자기 tsconfig와 node의 type으로 lint합니다. consumer에서는 oxlint-tsgolint가 그 사본을 project 밖에서 검사했고, 거기서는 모든 `node:*` import가 `any`였습니다. 설치된 kit이 package-lock.json의 version이 아니면 make lint-ts는 make kit-check의 finding으로 실패합니다. 사본 `scripts/kit/bootstrap/files.mts`와 `digest.mts`는 K150이 그 lint만을 위해 좁혔던 byte의 type을 다시 `NodeJS.ArrayBufferView`로 받습니다(K157).
- `go.work`가 Git이 추적하지 않는 go.mod의 module(무시되는 형제 레포의 clone 등)을 use하면 `make dependency-policy-mutation-check`는 finding 하나로 실패합니다: go.work와 `use` 경로를 밝히고, commit된 go.work는 추적되는 module만 use할 수 있다고 알립니다. 이 check의 사본은 추적되는 파일만 담으므로, 그 go.mod를 읽다가 stack과 함께 ENOENT를 던졌습니다(K160).
- `config/knip-entries.json`이 어떤 JavaScript도 import하지 않고 make만 실행하는 root의 dependency(hyper가 recipe를 위해 URL로 설치하는 template compiler 등)를 `ignoreDependencies`(`{ "<package>": "<reason>" }`)에 선언하고, make lint-ts는 그것을 `var/lint-ts/knip.json`에서 knip.json의 `ignoreDependencies` 뒤에 더합니다: knip은 Makefile을 읽지 않으므로 그 dependency를 unused로 보고했습니다(K159).
- 복사되는 `.oxlintrc.json`이 `oxc/number-arg-out-of-range`를 끕니다: 이 rule은 `toFixed`와 `toExponential`의 소수 자릿수 0에서 20, precision 1에서 21만 허용하는데, 이는 ES2018이 100으로 올리기 전의 한계입니다(ECMA-262 `Number.prototype.toExponential`). 그래서 `toExponential(25)` 같은 올바른 code를 실패시켰습니다. 최신 release인 oxlint 1.88.0과 oxc main도 옛 한계를 유지하며, 이를 보고한 oxc issue는 없습니다(K161).
- kit의 도구가 읽는 모든 JSON(파일이나 command의 출력)은 `scripts/kit/schema`의 schema 파일(JSON Schema 2020-12, `schema-validate.mts`의 strict Ajv2020)로 검증되고 cast가 아니라 ajv의 type guard로 type을 얻습니다: `readConfig<T>(root, file, schema)`, `readJsonFile<T>`, `parseJson<T>(text, schema, source)`는 T를 돌려주거나, 파일이나 command와 ajv 각 error의 JSON Pointer를 밝히는 `SchemaError`를 던지며, `readConfigFindings<T>`는 check에 그 줄을 finding으로 줍니다. `readConfig`는 이제 `{ value, errors }`를 돌려주지 않고 던지며, 호출자가 T를 정합니다. 새 schema는 kit이 읽는 package.json, package-lock.json, composer.json, composer.lock, knip.json의 부분과 gh, npm, composer, go, cargo, pip, vitest, rustdoc 출력의 부분, kit이 스스로 쓰는 record를 기술합니다. 그것을 어기는 레포의 manifest(예: list가 아닌 `workspaces`)는 이제 파일과 JSON Pointer와 함께 실패합니다. ajv가 설치되기 전에 도는 bootstrap은 사본 `scripts/kit/bootstrap/files.mts`의 `readJsonObject`로 JSON object를 읽고 각 field를 검사합니다. 예시 호출자는 `scripts/kit/kit-check.mts`입니다(K158).
- `make lint-php`는 Composer package에 Composer가 그 파일에 주는 autoloader로 PHPStan을 실행합니다: package의 `vendor/autoload.php`, 또는 그 위의 가장 가까운 Composer project(path repository로 library를 require하는 Composer monorepo의 root development composer.json 등)의 것입니다. `COMPOSER_VENDOR_DIR`는 run-tests의 PHPUnit처럼 다른 vendor directory를 지정하며, 둘 다 `scripts/kit/composer-vendor.mts`로 그것을 찾습니다. 이전에는 `<package>/vendor/autoload.php`를 요구했는데, lock도 자기 vendor/도 없는 그런 monorepo의 library에는 그것이 없습니다. PHP 파일이 있고 자신에게도 위에도 autoloader가 없는 package는 여전히 실패하며, 이제 그것을 설치할 수 있는 project를 밝힙니다(K163).
- `config/knip-entries.json`이 `ignore`(`{ "<glob>": "<reason>" }`)에 의도적으로 쓰이지 않는 파일(site가 보여 주고 아무것도 실행하거나 import하지 않는 sample source 파일 등)을 root 기준 glob과 이유로 선언하고, make lint-ts는 그것을 `var/lint-ts/knip.json`에서 그런 파일을 위한 knip의 문서화된 option인 knip.json의 `ignore` 뒤에 더합니다. 선언하지 않은 unused 파일은 여전히 실패합니다(K162).
- 복사되는 `.golangci.yml`이 staticcheck `ST1005`("error strings should not be capitalized")를 끕니다: polyspec의 error string은 레포 spec의 cross-port message이고 모든 port가 byte 단위로 같게 돌려주므로 spec의 대소문자를 유지합니다. 다른 check는 golangci-lint 2의 기본값입니다. 또 `issues.max-same-issues`와 `issues.max-issues-per-linter`를 0으로 두어 모든 finding을 보고합니다: 같은 text의 issue 3개와 linter 하나의 issue 50개라는 기본 상한이 한 레포에서 finding 121개 중 118개를 숨겼습니다(K164).
- `run-tests phpunit`은 `--php-extension`을 여러 번 받아 각 extension을 PHP 자체의 방식인 자기 `-d extension=<path>`로 주어진 순서대로 load하므로, extension은 그것이 의존하는 extension 뒤에 load됩니다. 각각이 build되었는지 tool이 시작하기 전에 확인합니다. 레포는 하나가 다른 하나에 의존하는 extension 둘을 한 PHPUnit run에서 load할 수 있습니다(K165).
- 복사되는 `.oxlintrc.json`이 `any`의 모든 unsafe 흐름을 error로 실패시킵니다: `typescript/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`은 any 값이 인자, 대입, 호출 대상, member access의 객체, 반환값이 되면 실패시키고, `typescript/no-unsafe-type-assertion`은 type을 좁히는 type assertion을 실패시킵니다. kit은 JSON을 schema로 읽고(K158), unknown 값을 검사로 좁히며, 있다고 아는 값은 `scripts/kit/present.mts`의 `present`로, errno code는 `process.mts`의 `errorCode`로 읽습니다(K157).
- `make python-lock`이 `make python-venv`처럼 uv shim을 checkout의 mise 환경으로 실행하므로, make 밖에서 `node scripts/kit/python-lock.mts`가 더는 `Config files in <checkout>/mise.toml are not trusted`로 실패하지 않습니다. Python 도구의 real test도 자기 shim 호출에 같은 환경을 줍니다(K157).
- Python wheel의 build backend는 tool pin인 `config/toolchain.json`의 `pythonBackend` 하나로만 선언합니다: install-tools가 그것을 설치하고, `make release-backend`, `release-assets`, wheel build는 그것을 거기서 읽습니다. `config/release.json`의 `buildBackend`는 schema에서 빠졌습니다. `buildBackend`만 선언한 레포는 install-tools가 backend를 설치하지 않아 release가 release-assets에서 실패했습니다(`setuptools-84.0.0 wheel is missing`). `wheel` package나 wheel consumer가 있고 `pythonBackend`가 없는 `config/release.json`은 이제 `make kit-check`와 release에서 고치는 방법과 함께 실패합니다(K166).
- `make release-coverage`는 kit이 쓰는 file을 kit 자신의 기록에서 도출하여 릴리스되지 않는 것으로 보므로, 어떤 레포도 그것을 분류하지 않습니다: 실행 중인 package의 `kit.copies` 사본(`config/php-lint/composer.json` 등), PHPUnit의 Composer project `config/phpunit/composer.json`, `.mise/locks/` 아래 mise의 lock tree(`.mise/locks/<tool>/<version>/pyproject.toml` 등)입니다. 복사되는 `config/layout.kit.yml`은 `package.json`과 `package-lock.json`처럼 Composer monorepo의 root `composer.json`과 `composer.lock`을 허용합니다(K167).
- `make dependency-review`는 Composer monorepo의 published package의 requirement를 review합니다: `composerPlatforms`의 root composer.json의 first-party requirement는 그 `require`와 `require-dev`, 그리고 `path` repository가 제공하는 각 package(root lock의 path dist 항목)의 `require`이며 version은 root lock의 것입니다. review는 root에서 `composer outdated --locked --all --format=json`을 한 번 실행하고 그 package만 남깁니다. `--direct`는 root의 requirement만 세었으므로 published package의 requirement(symfony/console 등)가 review에서 빠졌습니다. third-party package만 require하는 library는 여전히 review하지 않습니다. `UPDATE=1`은 published package의 requirement를 그 directory의 `composer require --no-update`와 root의 `composer update --with-dependencies`로 올립니다(K168).

### 소비자 이전

실행:
- `.oxlintrc.json`과 `scripts/kit/bootstrap`의 사본을 쓰는 `make kit-sync`(K155, K157, K161, K166).
- `.golangci.yml`을 쓰는 `make kit-sync`, 이어서 `make lint-go`: 상한이 숨겼던 모든 finding을 이제 보고하며, 각각을 code에서 고칩니다(K164).
- Composer monorepo에서 published package의 requirement를 기록하는 `make dependency-review RECORD=1`. 기록이 그것을 담을 때까지 `make dependency-policy-check`는 실패합니다(K168).

추가:
- make만 실행하는 root dependency(hyper의 `@polyspec/template-compiler` 등)마다 이유와 함께 `config/knip-entries.json`의 `ignoreDependencies`(K159).
- knip이 unused로 보고하지만 의도적으로 그런 파일(site가 보여 주는 sample 등)마다 이유와 함께 `config/knip-entries.json`의 `ignore`(K162).

수정:
- `make lint-ts`의 새 finding 하나하나를 disable 없이 code에서: tsc를 잠재우는 `@ts-ignore`나 `@ts-nocheck`, cast, `any`를 없애고 tsc가 통과하도록 type을 답니다. test에 필요한 `@ts-expect-error`는 기대하는 error를 밝힙니다(K155).
- `make dependency-policy-mutation-check`가 보고하는 `go.work`: use하는 module의 go.mod를 commit하거나 `use`를 지웁니다. 형제 레포의 local clone은 commit하지 않는 go.work나 `GOWORK`에 둡니다(K160).
- 도구가 이제 schema의 JSON Pointer와 함께 거부하는 manifest나 설정(예: `workspaces`가 object인 package.json, `repositories`가 object인 composer.json): schema의 형태로 씁니다(K158).
- `make lint-php`만을 위해 자기 lock이나 vendor/를 두었던 Composer monorepo의 library: 그것을 지우고 root development project에서 `composer install`을 실행합니다. 이제 그 vendor/가 lint에 쓰입니다(K163).
- `make lint-ts`의 `no-unsafe-*` 규칙의 새 finding 하나하나를 disable이나 cast 없이 code에서: JSON은 schema로 읽거나 `JSON.parse`의 unknown 값을 검사로 좁히고, error는 unknown으로 잡아 `instanceof Error`로 검사합니다(K157).
- 레포의 tsconfig: `make lint-ts`가 lint하는 모든 TypeScript 파일을 script와 benchmark까지 include하고, kit의 사본인 `scripts/kit`은 exclude합니다. project 밖의 파일에는 type이 없어 그 안의 import 호출은 모두 `typescript/no-unsafe-call`로 실패합니다(K157).
- 이제 `make kit-check`가 거부하는 `config/release.json`의 `buildBackend`: `config/toolchain.json`의 `pythonBackend`(`{ "requirement": "<name>==<version>", "sha256": "<sha256 of its wheel>" }`)로 옮기고 `make install-tools`를 실행합니다(K166).
- kit이 쓰는 file(`.mise/locks/…`, `config/php-lint/composer.json`, `config/phpunit/composer.json`)에 대한 `config/release.json`의 `notReleased` 항목과 `config/layout.yml`의 `vars.root_files`에 있는 `composer.json`, `composer.lock`: 이제 kit이 다루므로 지웁니다. `make kit-sync`가 `config/layout.kit.yml`을 씁니다(K167).

## 0.0.45

- knip.json은 make, go, rustup, shasum에 더해 polyspec이 mise나 setup으로 고정하는 runtime인 php, composer, python3, cargo, node, git의 binary를 무시합니다: php나 composer를 spawn하는 script가 unlisted binary였습니다. 한 레포만의 system 도구(Apple `container` 등)는 `config/knip-entries.json`의 `binaries`(`{ "<name>": "<reason>" }`)에 이유와 함께 선언하고, make lint-ts는 `entries`를 entry에 더하듯 그것을 `ignoreBinaries`에 더합니다. 이제 `entries`는 선택입니다(K152).
- `make dependency-policy-mutation-check`가 의존성 파일과 함께 `go.work`와 `go.work.sum`을 복사합니다: 그것이 없으면 workspace의 다른 member만 요구하는 module에 가질 수 없는 go.sum을 요구했으므로, `make dependency-policy-check`는 통과하는데 template(`tools/showcase/adapters/go`)에서 이 check가 실패했습니다(K153).
- `config/knip-entries.json`이 자기 package.json을 가진 중첩 npm project를 knip workspace로 선언합니다: `workspaces`는 그 directory를 이유, 그 directory 기준의 `entries`, `ignoreDependencies`(그 JavaScript가 import하지 않는 dependency, Rust test만 읽는 것 등)에 각각 이유와 함께 대응시키고, make lint-ts는 그것을 `var/lint-ts/knip.json`의 `workspaces`에 더합니다. root entry로 두면 그 dependency가 root에서 unlisted였습니다(ssr `packages/build/tests/fixtures`). 그 `.svelte` 파일은 knip의 Svelte plugin이 compile합니다(K154).

### 소비자 이전

실행:
- knip.json을 쓰는 `make kit-sync`(K152).

추가:
- script가 spawn하여 knip이 unlisted binary로 보고하는 레포의 system 도구(hyper의 `container`, template의 `gmake` 등)마다 이유와 함께 `config/knip-entries.json`의 `binaries`(K152).
- ssr `packages/build/tests/fixtures` 같은 중첩 npm project마다 그 파일을 root entry로 선언하지 않고 이유, entry, 무시하는 dependency와 함께 `config/knip-entries.json`의 `workspaces`(K154).

## 0.0.44

- kit의 도구는 repository root를 스스로 찾습니다. root는 working directory가 속한 Git work tree의 top level이므로, `npm -w`가 package directory에서 시작하듯 root 아래에서 시작한 도구도 repository의 path를 읽고 씁니다. `paths.mts`의 `ROOT`는 이제 처음 쓸 때 읽는 `repositoryRoot()`이며, root가 필요한 도구는 Git work tree 밖에서 실패합니다(K144).
- `config/release-assets.json`은 다른 polyspec repository의 release archive를 version, URL(`{version}`), sha256, 무시되는 var/ 아래 directory와 함께 한 번 고정합니다. `make release-assets-fetch`(ONLINE)는 var/에 없는 archive를 sha256을 확인하며 내려받고 `unpack`이 있는 zip을 풀며, `release-assets.mts version <name>`은 Makefile에 version을 주고, config/release.json의 `consumers.composer.polyspec`는 polyspec 의존성의 release zip을 Composer consumer의 artifact repository에 두며 release-tools가 그것을 내려받습니다(K140).
- 레포는 사본 knip.json을 고치지 않고 knip entry를 더합니다: `config/knip-entries.json`이 layout entry 밖에서 make가 실행하는 파일마다 이유를 적고, make lint-ts는 knip.json과 그 entry(`var/lint-ts/knip.json`)로 knip을 실행합니다. knip.json에는 더는 주석이 없으므로 lint-ts가 JSON으로 읽습니다(K145).
- `layout-root-files`는 레포의 root 파일을 kit의 목록에 더합니다: config/layout.yml은 자기 파일의 glob alternation인 `vars: { root_files: "{a,b}" }`만 정하며, make layout-check는 그 rule의 `paths`를 override하면 실패합니다(`layout-root-files-additive`). 그 override는 kit의 목록을 바꿨습니다(K145).
- `make install-tools`가 checkout에서 파일을 읽는 `rustup toolchain install --no-self-update`로 `rust-toolchain.toml`의 Rust toolchain을 그 component와 함께 설치합니다. rustup 1.28은 cargo가 처음 실행될 때 이를 더는 설치하지 않으므로, cargo를 실행하는 모든 CI job이 `toolchain '1.99.0-x86_64-unknown-linux-gnu' is not installed`로 실패했습니다. rustup이 없으면 그 설치 방법과 함께 실패하고, `make toolchain-check`는 설치되지 않은 toolchain을 수정 방법 `make install-tools`와 함께 알립니다(K151).
- `make install-tools`가 kit이 더는 쓰지 않는 `var/tools/bin`의 file을 모두 지웁니다. 예를 들어 kit 0.0.38의 `go`, `gofmt`, `python3`, `alint` wrapper입니다: 이 도구는 이제 mise에서 오며, PATH 맨 앞의 옛 wrapper가 mise의 shim을 가렸습니다. bootstrap의 mise, npm, npx와 선언된 Composer project의 wrapper는 남깁니다(K149).
- 사본 `scripts/kit/bootstrap/files.mts`와 `digest.mts`가 byte를 `NodeJS.ArrayBufferView`가 아니라 `Uint8Array`로 받습니다: consumer의 tsconfig는 kit의 사본을 담지 않아 oxlint-tsgolint가 node의 type 없이 검사했고, 해석되지 않은 type이 0.0.43의 ordered-json에서 `typescript/no-redundant-type-constituents`를 실패시켰습니다(kit 자신의 lint는 통과). make kit-sync를 실행하세요(K150).
- ruff가 복사된 `ruff.toml`의 `cache-dir`로 cache를 `var/ruff`에 둡니다: `make lint-python`이 repository root에 `.ruff_cache`를 남겼고, layout S5는 ignore하지 않는 한 이를 거부합니다. make kit-sync를 실행하고 `.ruff_cache`를 지우세요(K147).

### 소비자 이전

추가:
- `config/knip-entries.json`: knip.json의 layout entry 밖에서 make가 실행하는 파일(test probe 등)을 사용하지 않는 파일로 남기지 않고 이유와 함께 선언합니다(`{ "schema": 1, "entries": { "<glob>": "<reason>" } }`)(K145).
- 레포가 내려받는 다른 polyspec repository의 release archive마다 `config/release-assets.json`을, install target에 `make release-assets-fetch`를 둡니다. 자체 downloader(hyper의 `scripts/template-assets.mts`와 `config/template-assets.json`, fsm의 `composer-artifacts` recipe와 `config/composer-artifacts.txt`)는 지웁니다. tag가 필요한 Makefile은 `$(shell node $(KIT)/release-assets.$(KIT_EXT) version <name>)`로 읽습니다. 목적지는 var/ 아래에 있으므로 Composer `artifact` repository는 그 directory를 적습니다(K140).
- polyspec 의존성을 설치하는 Composer consumer에는 inline package repository 대신 config/release.json의 `consumers.composer.polyspec`와 consumer composer.json의 그 version `require`를 둡니다. make release-consumer-lock을 다시 실행합니다(K140).

변경:
- `config/layout.yml`: `layout-root-files`의 `paths` override를 레포의 root 파일만 적는 `vars: { root_files: "{a,b}" }`로 바꿉니다. 예를 들어 `- id: layout-root-files`에 `vars: { root_files: "{tsconfig.build.json}" }`를 둡니다. make layout-check는 그 override에서 실패합니다(K145).

실행:
- `ruff.toml`과 `scripts/kit/bootstrap`의 사본을 쓰는 `make kit-sync`(K147, K150), 이어서 `rust-toolchain.toml`의 Rust toolchain을 설치하고 `var/tools/bin`의 낡은 wrapper를 지우는 `make install-tools`(K151, K149). cargo를 실행하는 CI job은 그 앞에 `make install-tools`를 실행합니다.

제거:
- root의 `.ruff_cache`와, 그것 때문에 `.gitignore`에 넣은 항목이 있다면 그 항목(K147).

## 0.0.43

- parity는 test가 tests/<name>/main.rs인 cargo binding을 module을 가진 test target의 Cargo layout대로 `--test <name>`으로 실행하고, tests/<name>/의 다른 file을 binding이 없는 test가 아니라 그 binding의 module로 셉니다(K148).
- knip은 make가 실행하는 파일을 layout에 따라 entry로 둡니다: kit의 사본을 포함한 `scripts/` 아래 script, `benchmarks/`의 프로그램, 모든 node:test 파일이며, Makefile이 include하는 `@polyspec/kit`은 쓰이지 않는 dependency가 아닙니다. kit은 CI에서 make lint-ts로 자신을 lint하고 찾은 것을 고쳤으며, 그중에는 모든 consumer의 lint를 실패시킨 `scripts/kit/bootstrap/install-mise.mts`의 template literal이 있습니다. make kit-sync를 실행하세요(K142).
- `make dependency-review`와 `make dependency-policy-check`는 없는 설정 파일을 이름으로 알리고(`config/dependency-policy.json is missing; …`) 읽기의 stack trace 대신 상태 1로 끝납니다. 다른 모든 오류는 stack을 그대로 둡니다(K146).
- mise.toml은 cargo-nextest(`"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`)와 cargo-deny(`cargo-deny`, mise registry의 aqua backend)를 선언할 수 있습니다. mise.lock이 모든 플랫폼의 native binary를 고정하고 make toolchain-check가 그 `--version`을 읽습니다. 이전에는 kit가 둘 다 거부했습니다(K143).
- run-tests는 test가 timeout을 넘었을 때와 실행기 자신이 중단될 때(SIGINT, SIGTERM, SIGHUP) tool의 process group 전체를 멈추고, 5 s의 유예 뒤에는 SIGKILL을 보냅니다. 중단된 실행기는 tool과 그것이 시작한 process(mise shim 뒤의 interpreter 등)를 고아로 남겼습니다(K141).
- `no-floating-promises`는 typescript-eslint의 option `allowForKnownSafeCalls`로 node:test의 최상위 등록(`test`, `describe`, `it`, `suite`)을 허용합니다. runner가 그것을 기다리기 때문이며, test 안의 진짜 floating promise는 여전히 실패합니다. make kit-sync를 실행하세요(K138).
- API Extractor는 더는 `ae-missing-release-tag`를 보고하지 않습니다: polyspec은 export에 `@public`이나 `@beta`를 달지 않고 잘라낸 rollup을 쓰지 않으므로, `make lint-ts`가 모든 package에서 이것으로 실패했습니다. make kit-sync를 실행하세요(K139).
- parity는 test target이 libtest-mimic(`harness = false`)을 실행하는 cargo binding의 case를 읽습니다. libtest-mimic은 각 test 이름을 `...` 앞에서 가장 긴 이름에 맞춰 채우므로, 이전에는 그 case를 하나도 읽지 못했습니다(K136).
- php suite binding은 test method를 `symbol`로, fully qualified class의 `<class>::<method>`로 적습니다: parity는 그 method만 `--filter`로 실행하고, data provider의 각 data set `<method> with data set "<case>"`가 case `<case>`입니다. 이전에는 data set이 어떤 case에도 대응하지 않았고, 파일의 다른 test는 모두 unit이 선언하지 않은 case였습니다(K137).

### 소비자 이전

변경:
- case가 한 test method의 data set인 php suite binding은 `"symbol": "<Namespace>\\<Class>::<method>"`를 선언합니다. case가 test method `test_<case>`인 binding은 그대로 둡니다.

## 0.0.42

- bootstrap이 `var/tools/go.mod`를 써서, `var/tools` 아래 mise의 Go와 그 test 소스가 별도 module이 되며, 루트가 Go module인 저장소의 `./...`가 그것을 훑지 않습니다(K135).
## 0.0.41

- mise.lock은 bootstrap이 mise를 설치하는 모든 플랫폼인 linux-arm64와 macos-x64의 archive도 고정합니다. 0.0.39와 0.0.40은 ARM Linux runner에서 make install-tools가 실패했습니다(K134).
## 0.0.40

- kit-sync는 package가 더는 선언하지 않는 `scripts/kit/`의 파일(0.0.39 이후의 `scripts/kit/bootstrap/bootstrap-npm.mts` 등)을 지우고, kit-check는 그런 파일을 보고합니다(K133).
- make toolchain-lock은 mise 환경이 mise.toml을 global configuration으로 지정하므로 `mise lock --global`로 그 도구를 잠급니다. 0.0.39는 lock이 없는 저장소에서 lock을 쓰지 못했습니다(K127).
- release workflow는 `make release-tools` 전에 `make release-prepare`를 실행합니다: 저장소는 release에 필요한 준비를 Makefile의 `release-prepare::` 규칙으로 선언합니다(K132).

### 소비자 이전

추가:
- sibling release의 checkout처럼 release에 준비가 필요한 저장소는 workflow의 단계 대신 Makefile의 `release-prepare::`로 이를 선언합니다.

## 0.0.39

- mise의 shim은 어느 작업 디렉터리에서든 checkout이 pin한 도구를 실행합니다: mise 환경이 checkout의 mise.toml을 global configuration으로 지정합니다(K127).
- 0.0.38의 원칙 검토(K129): stable release가 없는 Go module, npm advisory 범위, revision의 tracker는 빈 값으로 읽히는 대신 이름과 함께 보고되거나 실패합니다. 모든 npm workspace pattern을 읽고, go.work가 resolve하는 module에는 go.sum이 필요 없으며, PHP lint는 PHP를 선언한 저장소의 도구일 뿐이고, ts extractor는 standard library를 받으며, go.mod와 go.work는 tab으로 들여쓰고, 중첩된 test 실행의 실패한 case는 오류 전문과 함께 보고됩니다.
- status table, changelog section, release note, checklist, parity 산문을 mdast tree에서 읽습니다(K130).
- `@polyspec/kit`이 repository가 import하는 tool API를 export합니다: `tracked-files`, `test-hooks`, `test-progress`, `run-tests`, `holder-lock`, 그리고 optional peer `@vscode/test-electron`이 필요한 `install-vscode`(K79).
- kit이 자체 release installer로 설치하던 도구는 mise가 `mise.toml`에서 `mise.lock`의 digest로 설치합니다(K127): Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, Composer, vulture. bootstrap은 `packageManager`의 npm 다음에 `config/toolchain.json` `mise`의 sha256으로 mise를 설치하고, `make toolchain-lock`이 `mise.lock`을 쓰며, `make install-tools`는 `mise install --locked`를 실행한 뒤 wheel backend, Composer project, `exceptions`의 Rust channel을 설치합니다. kit.mk의 모든 recipe는 checkout의 mise 환경으로, 그 shim을 PATH 맨 앞에 두고 실행되며, checkout 밖은 아무것도 바뀌지 않습니다.
- check-toolchain은 `mise.toml`의 도구를 shim으로 실행하고, `mise.lock`이 모든 archive를 linux-x64와 macos-arm64의 sha256으로 고정할 것을 요구하며(`go:` 도구인 govulncheck와 deadcode는 Go의 checksum database로), `mise.toml`의 go와 python minor를 kit의 pin과 비교합니다(K127).

### 소비자 이전

처음 도입: `scripts/kit/kit-bootstrap.mk` 자체가 사본이므로 그것이 생기기 전에는 `make`가 실패합니다. `npm install`이 pin한 `@polyspec/kit`를 추가한 뒤 저장소 root에서 `node node_modules/@polyspec/kit/dist/kit-sync.mjs`를 한 번 실행하면 Makefile이 include하는 파일을 포함한 모든 사본을 씁니다. 그 뒤로는 `make kit-sync`를 씁니다.

추가:
- `config/dependency-policy.json`의 `advisoryExceptions`에 sprintf-js의 advisory 1241202. `@polyspec/kit`이 `@microsoft/api-extractor`를 거쳐 가져오며 어떤 release도 고치지 않습니다. kit이 스스로 선언한 reason과 removal condition을 씁니다.
- `config/toolchain.json` `mise`: kit이 선언한 대로 version과 platform별 archive의 sha256. `make install-tools TOOLS=npm`이 이를 설치합니다.
- 저장소가 설치하는 도구를 정확한 release로, Go와 Python은 kit의 pin으로 적은 `mise.toml`. 그다음 `make toolchain-lock`이 쓰는 `mise.lock`과, `pypi:` 도구가 있으면 `.mise/locks/`. Composer 같은 `http:` 도구의 `checksum`은 `mise.toml`에 선언합니다.
- `config/layout.yml`이 root 목록을 덮어쓰는 곳에 `mise.toml`, `mise.lock`, `.mise`.

변경:
- make를 실행하는 CI 단계에는 따로 PATH가 필요 없습니다. kit.mk가 `var/tools/bin`과 shim을 맨 앞에 둡니다. `make release-tools-path`는 mise의 환경도 `GITHUB_ENV`에 씁니다.

삭제:
- `config/toolchain.json`의 `python`, `pythonBuild`, `uv`, `ruff`, `vulture`, `alint`, `golangciLint`, `deadcode`, `composer`, `cargoAudit`, `govulncheck`, `go`; `.python-version`.
- `make install-tools` 뒤의 도구 이름. 이 target은 `mise.lock`의 모든 도구를 설치합니다.

증명: `make install-tools TOOLS=npm`, `make install-packages`, `make toolchain-lock`, `make install-tools`, 그다음 `make toolchain-check`가 통과합니다.

## 0.0.38

- kit은 npm package `@polyspec/kit`입니다. 저장소는 `make install-tools TOOLS=npm`과 `make install-packages`로 이를 설치하고, `scripts/kit/kit-bootstrap.mk`를 include하며, `kit.copies`의 파일만 사본으로 둡니다. `make kit-sync`가 설치된 package에서 이를 쓰고, `make kit-check`가 package-lock.json의 버전에 묶습니다(K71-2).
- kit의 tool과 test는 TypeScript(`.mts`)이며 tsc 7.0.2가 검사합니다(K71-1). 실행이 checkout을 바꾸면 `make kit-test`가 실패합니다(K71-2-1).
- kit의 tool은 재발명 대신 생태계 library를 씁니다: schema는 ajv, glob은 picomatch, TOML은 smol-toml, PEP 508은 pip-requirements-js, version은 semver와 @renovatebot/pep440입니다. Composer version은 composer 자체의 `latest-status`에서 오며, npm install-links 사본은 더 읽지 않습니다(K73, K100, K112–K116).
- 모든 kit tool은 `config/rebuild.json`에 분류되고, kit이 유지하는 tool은 `docs/rebuild/`에 rebuild 기록을 가집니다(K74).
- parity: runner test id에 대한 feature unit, runner별 고정 test 규약, test처럼 이름 붙은 파일의 bind 의무, profile 이유의 spec anchor, vitest runner, symbol 추출(Go, TypeScript, PHP, Python, 선언된 nightly의 Rust), case directory와 `.~` 단계, Markdown 목록과 prose 이름(K75, K42, K43).
- 모든 생태계의 lint 설정(phpcs PSR-12, phpstan 금지 호출, Composer policy, Rust workspace lint, gomoddirectives를 둔 golangci-lint, deadcode, TID251을 둔 ruff, vulture, tsgolint를 둔 oxlint, knip, API Extractor, `.editorconfig`). 고쳐진 release가 없는 advisory는 이유와 제거 조건을 적은 기록된 예외로만 받아들입니다(K77).
- check-toolchain은 kit이 내보내는 pin, pin과 같은 하한, scope·이유·재시도를 가진 선언된 예외, TypeScript pin, `.npmrc` link key를 검사하고, tool을 끝낸 signal의 이름을 댑니다(K78, K118).
- editor 경계 checker와 통합 test의 VS Code installer(K80).
- Markdown은 mdast와 micromark로 읽고, owner-check는 make의 database를 읽으며, pyproject pin은 toml-patch로 고치고, wheel metadata는 pip의 report에서 오고, govulncheck는 SARIF로 읽으며, 중복은 jscpd가 찾고, 쓰이지 않는 TAP reader는 지웠습니다(K120–K126).
- release coverage는 repository의 폴더를 가리키지 않는 `file:` dependency를 거부합니다. smoke의 archive를 가리키는 것은 npm release consumer project뿐입니다(K129).
- Node 26.11.1.

### 소비자 이전

추가:
- 이 release의 asset URL과 integrity로 pin한 devDependency `@polyspec/kit`, package.json과 package-lock.json에.
- Makefile의 `include scripts/kit/kit.mk` 대신 `include scripts/kit/kit-bootstrap.mk`.
- `make kit-sync`가 쓰는 사본: `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, `workflows/release.yml`, `PRINCIPLES.md(.ko)`, `config/layout.kit.yml`, `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json`, `.editorconfig`.
- 없으면 저장소 체크리스트의 `config/checklist.json`; Rust가 있으면 Rust pin의 `rust-toolchain.toml`.

변경:
- `.node-version` 26.11.1과 `engines.node` `>=26.11.1`; Composer `require.php` `>=8.5`와 `config.platform.php` `8.5`; `requires-python` `>=3.14`; toolchain 줄 없는 go.mod `go 1.27.2`; Cargo `rust-version` `1.99.0`; `typescript` `7.0.2`, 다른 version은 예외로 선언.
- `config/parity.json`: `symbols`는 `{ extractor, entry }`; 좁은 profile과 `nativeOnly` 항목은 `spec` anchor를 가집니다; Go나 PHP symbol을 추출하면 `config/toolchain.json`이 `symbolExtractors`를 적습니다.

삭제:
- vendored `scripts/kit/*`, `tests/kit/*`, `.kit/kit.lock.json`과 모든 `kit.json` 참조.
- `.npmrc`의 `install-links`와 `bin-links`; go.mod의 `replace`(형제는 go.work); 중첩된 ruff 설정.

증명: `make install-tools TOOLS=npm`, `make install-packages` 다음 `make kit-check toolchain-check layout-check documents-check owner-validate`가 통과합니다. 여전히 실패하는 검사는 저장소 체크리스트에 기록합니다.
