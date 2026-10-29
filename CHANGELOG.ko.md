<!-- doc-id: changelog -->
<!-- source-sha256: c84f110c19394c0bcf15b3c152cb953344324c657114393c2013d11919a8c143 -->
# 변경 기록

[English](CHANGELOG.md)

## Unreleased

- done commit의 Red 줄은 sha 없이 명령과 그 exit status, `Red: <command> exit <n>`을 기술합니다. land가 branch를 rebase하므로 sha는 main이 갖지 않는 commit을 가리켰습니다. `at <sha>`도 계속 받습니다 (K875).
- make documents-stamp는 PATHS가 지정한 한국어 twin만 stamp합니다. stamp는 twin이 원문과 일치한다는 뜻이기 때문입니다. PATHS가 없으면 아무것도 stamp하지 않고, 원문이 바뀐 twin마다 다시 번역한 뒤 실행할 make documents-stamp PATHS=<twin>을 나열합니다. land는 marker가 충돌한 twin만 stamp합니다 (K877).

## 0.0.74

- K831, K832, K833, K834, K835, K836, K837, K839, K840, K871, K872, K873, K876, K881을 담아 Kit 0.0.74를 릴리즈합니다 (K880).
- 첫 후보 735bba12의 CI가 실패했으므로 0.0.74는 K872와 K881도 담습니다 (K882).
- toolchain-lock test는 run-tests가 모든 test에 설정하는 호출자의 UV_PYTHON 없이 make를 실행하므로 recipe가 지정한 UV_PYTHON만 봅니다 (K881).
- make link는 더 이상 연결된 provider checkout 안의 npm bin mode를 바꾸지 않습니다. node_modules/.bin link만 쓰므로 read-only로 mount된 provider checkout도 연결합니다. bin의 mode는 그 provider의 것, 곧 track된 mode나 그 build의 것입니다 (K872).
- link test의 K661-6 runner checkout 사례는 K831이 지운 lock-source finding 대신 K773의 manifest path finding을 기대하고, checklist test는 plan 폴더 세 개를 고정하지 않고 docs/plans/*/checklist.md에서 폴더와 개수를 얻으므로 새 plan 폴더가 test를 깨뜨리지 않습니다 (K876).
- make lint-php는 autoload 파일의 polyfill 가드를 허용합니다. symfony/polyfill-*의 bootstrap 파일처럼 elseif와 else가 없고 본문이 그 이름의 선언뿐인 namespace 안의 `if (!function_exists('<name>'))` 또는 `if (!defined('<name>'))`입니다. 그 밖의 가드는 여전히 실패합니다 (K873).
- make toolchain-lock은 x64와 arm64의 linux, macOS, Windows 중 archive가 있는 각 platform에 대한 kit.mk의 `mise lock`입니다. 먼저 mise.toml이 선언한 uv와 python을 mise가 나열하는 대로 lock하고 설치한 뒤 그 Python을 UV_PYTHON으로 지정하므로, uv가 machine의 uv나 home의 managed Python으로 lock하지 않습니다. scripts/kit/toolchain-lock.mts는 없어졌습니다. bootstrap이 설치한 mise를 실행하므로, mise.lock이 node를 고정하지 않은 checkout은 make install-tools TOOLS=npm, make toolchain-lock, 다시 make install-tools TOOLS=npm을 실행합니다 (K836).
- Composer package가 있는 release는 archive 옆에 packages.json을 게시합니다. config/release.json의 각 Composer package를 release version으로, 그 zip의 release asset URL과 zip의 sha1과 함께 담는 하나의 평면 Composer repository이므로, 소비자는 releases/download/<tag>/packages.json의 composer repository로 읽고 tag만 적습니다 (K871).
- PHP-Parser 5.0.0의 PHP arginfo project는 5.6.1의 것처럼 nikic/php-parser 5.0.0을 정확히 요구하므로, 삭제된 비교(K833) 대신 Composer가 그 요구를 만족하지 않는 parser의 lock을 거부합니다. link-state-check test는 K696 사례와 K831이 남긴 주석을 버립니다 (K837).
- kit은 rust-toolchain.toml의 channel을 `stable`이나 `1.90`을 포함해 선언된 그대로 읽습니다. rustup이 그것을 판정하며, kit은 더 이상 <major>.<minor>.<patch>가 아닌 channel도, make install-tools에서 channel이 없거나 필드 형식이 다른 rust-toolchain.toml도 거부하지 않고 선언된 것을 rustup에 넘깁니다 (K840).
- kit은 더 이상 자신이 실행하지 않는 도구의 mise.toml key나, https url과 version이 없는 http: 도구를 거부하지 않습니다. mise가 자기 설정을 판정하고, kit은 자신이 실행하는 도구만 검사합니다 (K839).
- kit은 mise.toml의 release를 선언된 그대로 받고 더 이상 mise.lock을 판정하지 않습니다. exact-release 거부, make toolchain-lock의 lock digest 검사, make toolchain-check의 sidecar 검사가 없어졌으며, `mise install --locked`가 lock과 sidecar를 스스로 검사합니다 (K835).
- PHP lint 도구는 config/php-lint/composer.lock이 기록한 phpcs와 phpstan release를 기록된 그대로 받습니다. kit은 더 이상 release가 <major>.<minor>.<patch>가 아닌 lock을 거부하지 않습니다 (K834).
- PHP arginfo 설치는 더 이상 php-arginfo/<release> lock의 nikic/php-parser release를 gen_stub.php가 이름 붙인 release와 비교하지 않습니다. 폴더가 그 release로 선택되므로 그 비교는 폴더를 자기 이름과 비교했습니다 (K833).
- link-state-check는 더 이상 tracked lock의 내용을 판정하지 않습니다. polyspec 패키지의 Cargo.lock 또는 package-lock.json 항목이 path나 link여도 finding이 아니며, lock은 그 package manager의 기록입니다 (K831).
- 추적되는 go.work가 있는 repository에서 `make test-go CASES=<pattern>`은 module별 run처럼 그 pattern을 workspace go test 하나에 `-run`으로 넘긴다. 이제 선택한 Go test의 local run이 선택 없는 run으로 거부되지 않는다(K832).

## 0.0.73

- K826, K827, K830을 담아 Kit 0.0.73을 릴리즈합니다 (K829).
- platform-bootstrap의 Windows process 단계에 10분 한도를, 실제 process를 시작하는 process-group test에 60초 timeout을 두어 멈춤이 job을 붙잡지 않고 그 한도로 실패합니다 (K830).

- run의 PHPUnit test 목록 실행(runtime-targets, K390-1)이 run의 autoloader를 deadline prepend에 넘긴다. 그래서 더는 "the PHPUnit Composer autoloader is missing"으로 끝나지 않는다 (K827).
- link된 Python 패키지를 빼는 uv 설치도 dev 폴더를 바이트 단위로 그대로 둡니다. kit은 모든 uv 설치 전에 link를 풀고(K539), 이제 실제 uv 케이스가 이 경우를 고정합니다 (K826).

## 0.0.72

- release, tag 생성, FINAL_RUN은 checklist row가 [~]나 [v]인 commit을 더 이상 거부하지 않습니다. row 상태는 기록이고, release는 tag된 commit의 CI가 증명합니다 (K825).
- CI는 package manager로만 설치합니다. gates workflow, kit-gates, kit-gates-parity, kit의 CI는 make link, link-state-check, package-link toolchain을 실행하지 않고, link와 그 검사는 개발 환경의 일입니다 (K824). 소비자 단계: 자체 CI에 있는 make link나 link-state-check 단계를 지웁니다.
- K820, K821, K822, K824, K825를 담아 Kit 0.0.72를 릴리즈합니다 (K823).
- K788의 소비자 단계: config/parity.json의 Python 선언은 각 심볼을 entry 기준 이름이 아니라 polyspec.<package>.app.App 같은 import 경로로 적습니다 (K823).
- platform-bootstrap의 Windows runner가 Git Bash make로 mise의 go shim을 실행해, K820의 PATH를 kit CI에서 증명합니다 (K822).
- worktree-setup은 worktree의 Composer 프로젝트를 일반 composer install처럼 Composer 자체 캐시와 네트워크로 설치하고, Composer보다 먼저 go.work를 준비합니다 (K821).
- Windows에서 kit.mk가 mise binary의 디렉터리를 var/tools/bin 옆 PATH에 둔다. 그래서 mise shim이 "program not found"로 실패하지 않고 mise.exe를 시작한다 (K820).

## 0.0.71

- K818을 담아 Kit 0.0.71을 릴리즈합니다 (K819).
- documents-stamp는 doc-id 줄 다음의 marker 줄만 씁니다. 본문에 예시로 보인 source-sha256 marker는 그대로 둡니다 (K818).

## 0.0.70

- Kit 0.0.70 릴리즈: 족쇄를 삭제하고 하네스만 남겼습니다 (K817).
- wheel 빌드는 uv build가 쓰기 전에 빌드 폴더를 만듭니다 (K816).
- gates workflow의 shared job은 commit range를 계산하지 않고 kit-gates-static에 RANGE를 넘기지 않습니다. commits-check가 삭제된 뒤로 어떤 target도 그것을 읽지 않습니다 (K815).
- layout-check는 worktree가 main의 install로 연결한 링크처럼 symlink인 install 폴더를 링크 자체로 검사합니다. .gitignore의 `vendor`가 그것을 무시하고, git이 symbolic link 너머의 pathspec이라며 거부하지 않습니다 (K814).
- release wheel 빌드는 uv build의 .gitignore 없이 wheel만 출력 폴더에 복사하고, 실제 도구 테스트는 kit wheel 폴더 없이 uv처럼 네트워크로 Python 패키지를 빌드합니다. 삭제된 revision 검사, 레거시 Composer projection, consumers 필드의 테스트를 맞췄습니다 (K813).
- toolchain-check 대상 테스트는 kit.mk가 정하는 node 경로를 읽으므로, main checkout의 도구를 쓰는 worktree에서도 통과합니다 (K792).
- plan은 더 이상 형식을 거부하지 않습니다. item-state는 선언된 어느 상태든 받고, item-new는 어떤 ID든 받아 docs-check가 나중에 판단할 행을 쓰며, make commit은 빈 인덱스, main의 새 행, 없는 본문 파일을 git에 맡깁니다. 완료 상태는 커밋 여부와 관계없이 각 변경 기록에 ID가 담긴 줄을 요구합니다 (K808).
- release는 version을 검사하지 않는다: `release-versions`, tag에 대한 각 manifest의 version, 자기 dependency의 정확한 version 검사를 지우며 package manager가 그것을 푼다. consumer 단계: 자기 workflow의 `make release-versions` 단계를 지운다 (K812).
- worktree-setup은 이름, id, type의 형식, worktree 밖의 Composer manifest나 vendor, 자신이 만들지 않은 Python 환경, worktree가 이미 가진 release archive 폴더로 worktree를 거부하지 않으며, 옛 Composer projection을 지우지 않는다 (K811).
- docs-check는 문서마다 따로 읽고 깨진 결과의 검사만 남긴다: 유일한 anchor, 닫힌 fence, link, private path, interpolation, checklist 읽기, status table cell, changelog 순서. 쌍 규칙은 지운다: `pair-missing`, `doc-id`, `revision`(source-sha256), anchor·fence·checklist·status table·changelog의 짝 일치, `plan-folder`, make commit과 pre-commit hook의 staged twin 검사 (K809).
- kit-check는 kit schema에 대한 설정, PHP 저장소가 선언한 PHP, 도구 recipe만 읽는다. target 이름, runtime target, CHECK_TARGETS 묶음, tracked link, owner rule의 lint 선택, retired 파일은 저장소의 것이며 더 검사하지 않는다 (K810).
- K315 cause 필터를 삭제합니다: item-state는 릴리스, flake, 무관한 실패, 환경, kit 행을 인용한 bypass 또는 불가 원인을 더 이상 거부하지 않습니다. 이 필터를 고정하던 테스트도 삭제합니다(K806).
- land는 실패한 gate를 baseline으로 main에서 다시 돌리지 않는다(K631): worktree에서 실패한 gate는 branch를 거부한다. 소유자가 없는 경로는 land를 거부하지 않고 gate를 고르지 않는다 (K807).
- 결과를 지키는 commit 규칙만 남긴다: AI footer와 identity, done 행의 Red 줄, fix의 test. commit의 subject 형식, 언어, identity, 행, type, 상태, changelog, generated, twin 규칙과 range mode 및 CI 단계를 가진 `commits-check`, config/commit-identity.json, pre-merge-commit hook, 아무것도 하지 않는 commit-gates hook을 지운다. consumer 단계: `make hooks` 뒤 `git rm .githooks/pre-merge-commit config/commit-identity.json`, workflow의 `commits-check` 단계를 지운다 (K805).
- push gate를 삭제합니다: push-gate.mts, pre-push hook, `make push-gate-hook`과 `push-gate-commit`, config/checklist.json이 pre-push를 나열해야 한다는 규칙. push는 검사하지 않고 message 규칙은 commit 때 실행합니다. config/release.json이 check를 적지 않으면 release-verify는 `ci-passed`를 검사합니다. 저장소는 .githooks/pre-push를 git rm으로 지우고, config/checklist.json의 `hooks`에서 pre-push를 빼고, push-gate라는 CI job이나 release check를 지웁니다. (K804)
- 릴리스의 consumer 설치와 proof를 삭제합니다(release-consumer.mts, release-consumer-config.mts, release-proof.mts, `make release-consumer`, `release-consumer-lock`, `release-proof`). config/release.json의 `consumers`와 `proof` 절, release-run prepare의 lock 단계, release-coverage의 file: dependency 형식 검사도 삭제합니다. 릴리스 설치는 consumer의 package manager가 합니다. release-tools는 install-tools만 실행합니다. git-tag parity owner는 `manifests`의 `git-tag` Cargo.toml이며 그 `[package].name`으로 이름을 정합니다. 저장소는 config/release.json에서 `consumers`와 `proof`를, 그리고 tests/release-consumer project를 지웁니다. (K798)
- python parity symbols는 다시 entry만 선언한다. distribution은 entry에서 위로 가장 가까운 pyproject.toml의 [project].name이며 `distribution` field는 지운다 (K803).
- PHP library 테스트를 Composer 자신의 autoload로 실행하고 Composer tool project를 그 자리에서 composer install로 설치합니다. php-library-autoload와 설치 staging을 삭제합니다. (K790) `run-tests --without-library`와 library source가 포함되지 않았는지 보던 실행 끝의 검사도 없어집니다. extension 실행은 package의 Composer project와 PHPUnit을 그대로 씁니다.
- lint-rust는 cargo clippy를 sibling checkout과 함께 link cargo로 실행하므로, link된 consumer는 lock의 git tag가 아니라 sibling의 polyspec crate에 대해 Rust를 lint한다. cargo는 subcommand 앞의 --config를 clippy 같은 external subcommand에 넘기지 않으므로, link cargo는 --config option을 subcommand 뒤에 넘긴다. (K802)
- wheel은 각 pyproject의 build-system.requires로 uv build가 만든다. pythonBackend, release-backend와 backend pin 검사를 지운다. python parity extractor는 config/parity.json의 새 `distribution` field가 가리키는 distribution의 설치 file 목록을, 저장소의 non-editable install이 만든 project 자신의 .venv의 python으로 읽으며 kit은 아무것도 설치하지 않는다. (K788)
- K495의 reference-transaction hook, pre-commit hook의 pid 기록, KIT_MAIN_WRITER를 지운다. main은 git이 허락하는 어떤 fast-forward로도 움직인다. commit과 land의 row-id 충돌 검사(K497, row-ids.mts)를 지운다. row의 충돌은 git의 merge conflict다. 저장소는 추적하는 .githooks/reference-transaction을 git rm으로 지운다. (K801)
- userland framework 위의 application은 자기 Composer package여야 한다는 S10 규칙과 그 layout-check(library-frameworks.mts)를 지운다. PHP library는 어떤 package든 require할 수 있다. (K800)
- kit-check는 kit 사본을 설치된 package와 비교하지 않고, package가 설치되고 lock되었는지도 검사하지 않는다. 설정만 검사한다. (K799)
- wheel-dependencies, pylock.mts, make python-lock과 python-lock-check가 있는 python-lock, schema가 있는 config/dependency-policy.json, config/release.json의 consumers.wheel.polyspec를 지운다. release-consumer는 각 wheel lock을 hash를 검사하는 uv pip install -r <pylock>로 설치하고, 저장소는 uv lock이나 uv export로 Python을 lock한다. (K789)
- 삭제된 테스트의 commit gate를 없앤다. 테스트 파일을 지우는 commit에 Replaced-By, Archived-To, Provider-Test-Replacement, Removed-With trailer가 필요 없다. (K797)

## 0.0.67

- Kit 0.0.67 release를 준비한다. (K795)
- Removed-With는 삭제된 테스트가 그 삭제된 파일을 직접 가리킬 때만 통과시키므로, 함께 지운 무관한 파일로는 gate가 열리지 않는다. (K793)
- K449의 commit-type 검사는 어느 폴더에서든 Markdown 문서를 문서로 읽고, release commit은 다른 lock과 함께 uv.lock을 stage할 수 있다. (K791)
- dependency-review, dependency-state, version.mts, pin-python-dependency, composer-provider-entries와 그 기록을 지운다. 낡거나 취약한 의존성은 npm, composer, uv, cargo audit와 govulncheck가 보고한다. (K786)

- dependency-policy-check와 dependency-policy-mutation-check를 지운다. lock은 npm ci, composer install, uv sync --locked가 검증한다. (K784)

- release manifest 검사는 저장소 자체 package의 tag version만 확인하고, K777의 polyspec release asset URL을 포함한 다른 모든 의존성의 형식은 package manager가 해석한다. (K785)

- worktree-setup은 추적되는 잠긴 uv project마다 uv workspace dir에 UV_PROJECT_ENVIRONMENT 또는 .venv를 붙인 환경을 준비하고, worktree가 main checkout에서 실행하는 .mise/locks의 pypi: 도구 환경은 준비하지 않는다. (K781)

- PHP library가 application framework를 require하지 않는다는 S10 규칙은 layout-check가 맡고, dependency-policy-check는 더 이상 검사하지 않는다. (K783)

- config/release-assets.json의 ignore 검사는 폴더나 그 상위 폴더 하나가 무시되면 받아들여, archive directory가 main checkout으로 link된 worktree에서도 release-assets가 실행된다. (K780-1)

- 테스트하던 동작과 함께 테스트를 지우는 commit은 parent가 추적했고 이 commit이 지우는 테스트 아닌 파일을 Removed-With: <path>로 밝혀 deleted-test gate를 통과한다. (K787)

- worktree-setup은 var/composer-artifacts를 복사하는 대신 config/release-assets.json의 release archive directory마다 main checkout의 directory로 가는 directory link 하나를 만들고, worktree는 make release-assets-fetch를 거부한다. (K780)

- worktree-setup은 추적되는 잠긴 uv project마다 uv workspace dir에 UV_PROJECT_ENVIRONMENT 또는 .venv를 붙인 환경을 준비하고, worktree가 main checkout에서 실행하는 .mise/locks의 pypi: 도구 환경은 준비하지 않는다. (K781)

- push-gate는 worktree에 커밋하지 않은 변경이 있는 branch를 병합된 것으로 보지 않으므로, 다른 세션이 막 시작한 항목이 모든 push를 막지 않는다. (K782)

- Kit 0.0.66 release를 준비한다. (K775)

## 0.0.66

- go.work release 테스트는 저장소를 initRepository로 만들고 release asset 테스트는 다른 저장소 이름을 쓰지 않는다. 모든 kit 테스트와 같다. (K779)

- release-assets와 release-candidate-assets만 저장소가 추적하는 go.work로 실행하고, dependency review, dependency policy와 나머지 release 대상은 다시 GOWORK를 끄고 실행하므로 각 module의 lock을 release된 그대로 읽는다. (K778)

- release의 manifest 검사는 polyspec package를 정확한 version의 GitHub release asset URL로 지정한 dependency를 받아들이고, 그 밖의 URL은 거부한다. (K777)

- link-state-check와 go benchmark 테스트 픽스처는 사례에 필요한 것 외에 저장소나 패키지 이름을 쓰지 않는다. (K776)

- release 대상과 dependency review는 저장소가 추적하는 go.work로 실행하고, 추적하는 것이 없을 때만 GOWORK를 끄므로 link가 쓰는 go.work는 계속 제외된다. (K774)

- link-state-check는 저장소 밖 경로로 패키지를 연결하는 추적 composer.json, package.json, pyproject.toml을 발견으로 보고한다. (K773)

- 배포본이 설치된 Python provider는 uv sync가 폴더를 남기지 않았어도 패키지 폴더가 링크된다. (K772)

## 0.0.65

- Kit 0.0.65 release를 준비한다. (K770)

- 0.0.65 candidate의 전체 CI가 실패한 test는 K755, K760, K761, K762, K765를 따르고 S11은 gate가 실행하는 check를 이름한다. (K771)

- uv-install은 uv.lock 없이 pylock.toml로 잠긴 project를 자체 설치처럼 uv pip install -r로 설치하므로 worktree-setup이 그런 project를 준비한다. (K769)

- make link은 링크된 npm 패키지의 node_modules/.bin 링크를 링크된 package.json으로 쓰므로 polyspec-kit-hook 같은 bin이 checkout의 source를 실행한다. (K767)

- worktree-setup은 오프라인 설치 뒤 npm처럼 설치된 Composer provider 폴더를 각각 checkout으로 링크한다. (K766)

- make link과 uv-install은 npm·Composer처럼 설치된 Python polyspec 패키지 폴더를 각각 checkout으로 가는 디렉터리 심링크 하나로 만든다. editable build를 하지 않으므로 링크에 build backend가 필요 없다. (K765)

- make link은 각 Python provider를 uv pip install --no-deps로 링크하므로, sibling을 릴리즈 URL로 선언한 provider도 오프라인으로 링크된다. 의존성은 uv pip check가 판단한다. (K763)

- npm ci가 링크된 kit 폴더를 릴리즈 복사본으로 바꾼 뒤에도 링크된 consumer는 make install 내내 sibling kit을 실행한다. (K762)

- make link가 설치된 npm·Composer polyspec 패키지를 각각 checkout으로 가는 디렉터리 심링크 하나로 쓰고 npm link나 composer update를 실행하지 않는다. link-check는 링크된 provider가 읽는 polyspec 패키지도 판단한다. (K761)

- go test -json이 benchmark의 pass event를 내지 않으므로, run-tests go가 benchmark를 결과 줄(출력함), 다음 benchmark 또는 package의 끝에서 끝낸다. (K760)

- Windows bootstrap이 Windows bsdtar로 archive를 풀어서, `D:`를 원격 host로 읽는 GNU tar의 Git Bash에서도 동작한다. (K759)

- commit-deleted-test가 sibling checkout에 링크된 provider는 그 checkout으로, 복사본은 lock으로 판단한다. (K758)

- rules-check가 `${{ matrix.runtime }}`를 쓰는 gates 단계를 runtime마다 한 번의 실행으로 읽어서 consumer의 runtime lint 규칙이 도달된다. (K757)

- kit-mk 테스트가 worktree가 실행하는 main checkout의 도구를 기대해서 worktree에서도 통과한다. (K756)

- release workflow가 kit-check를 반복하지 않는다; release-verify가 요구하는 태그 commit의 통과한 CI run에 이미 들어 있다. (K755)

- stopGroup은 SIGKILL이 필요했던 경우에도 멈춘 그룹이 끝난 뒤에만 반환한다. (K754)

- Playwright reporter를 rebuild-check 분류에 넣고 release-run 테스트의 remote를 initRepository로 만든다. (K753)

## 0.0.64

- 단일 release CI 전에 Kit 0.0.64 candidate, native consumer lock과 dependency review를 준비한다. (K752)

- Composer archive version을 tag에서 가져오고 native package repository metadata로 consumer를 증명한다; source composer.json은 바뀌지 않는다. (K748)

- run-tests가 project-local CLI와 kit reporter로 Playwright Test의 각 case를 실행한다. (K747)

- 성공한 CI run의 정확한 commit을 두 번째 version·test 주기 없이 게시하는 make release-candidate와 make release를 추가한다. (K749)

- 삭제된 테스트가 Provider-Test-Replacement로 lock되고 설치된 provider 테스트를 가리키면 받아들인다; 검증되지 않은 참조는 여전히 거부한다. (K746)

- rust-toolchain.toml의 channel, profile, components, targets를 rustup에 넘겨서, 이미 설치된 toolchain에도 빠진 component가 추가되게 한다. (K750)

- test-go가 go.work의 모든 모듈을 go test 한 번으로 실행해서, 빌드 전용 모듈이 더 이상 빈 실행이 되지 않는다. (K751)

- CI plan의 scalar output을 따옴표 없이 써서 복사된 workflow가 parity job을 고르게 하고, 선언 없는 단일 구현에는 parity job을 계획하지 않는다; gate runner를 고른다. (K745)

## 0.0.63

- release CI 전에 Kit 0.0.63 candidate, native consumer lock과 dependency review를 준비한다. (K744)

- 전체 parity 준비와 엄격한 설치 source 검증을 유지하면서 native source linking 범위를 각 runtime CI job에 맞춘다. (K743)

- 일반 gate 호출까지 parity target 열거를 늦춰 clean checkout의 npm bootstrap을 수정하고 혼합 goal의 엄격한 검증은 유지한다. (K742)

- native candidate 패키징, 잠긴 소비자 설치 및 최신 의존성 검토로 Kit 0.0.62를 준비했다. (K741)

## 0.0.62

- 검토한 stable 의존성 버전과 native toolchain digest를 갱신하고 취약점 검토 기록을 유지한다. (K740)

- 소유한 대소문자 구분 자원과 native process 정리를 사용해 workspace 및 infrastructure 테스트를 표준 runner로 실행한다. (K739)

- 지원되는 namespace event extension으로 native PHPUnit 개별 제한시간을 반영하고 명시적 watchdog 설정을 보존한다. (K738)

- source 갱신에 변경된 직접 exact Composer 요구사항을 포함하고 platform 제약은 package로 처리하지 않는다. (K737)

- native 잠금 uv 동기화와 선언된 source overlay로 worktree Python 환경을 준비한다. (K736)

- 정확한 Python unittest discovery 파일 pattern을 허용하고 뒤에서 넓은 pattern으로 바꾸는 선택을 거부한다. (K735)

- 안전한 Make target 생성과 정확한 recipe 검증으로 필수 전체 또는 API/binding parity gate 분할을 제공한다. (K734)

- 테스트 파일이 없는 정상 Go helper package를 이름이 있는 테스트의 skip 및 빈 테스트 실행과 구분한다. (K733)

- PHP arginfo 검증을 전체 toolchain 검사와 native extension build 범위에 적용한다. (K732)

- 소비자의 shared, runtime, parity gate를 선언된 잠금 setup으로 독립적으로 준비한 job에서 실행한다. (K731)

- 실패한 준비 및 검증을 포함해 필수 provider gate 전후에 선언된 CI 자원 context를 준비하고 정리한다. (K731-1)

- 고정된 Node, npm, Go, Rust를 사용하는 검증된 Windows bootstrap과 native Make/process 실행을 제공한다. (K730)

- 통과한 CI를 기준으로 native 후보 패키징, 잠긴 소비자 설치와 갱신한 의존성 검토를 거쳐 Kit 0.0.61을 준비했습니다. (K729)

## 0.0.61

- 임시 소비자 fixture가 찾는 위치에 PHP 파서를 설치하고 PHPStan raw 출력의 정확한 원인 유실 진단을 검증합니다. (K728)

- 잠긴 PHPStan 규칙으로 잡은 예외의 원인 유실을 거부하고 언어별 실제 오류 검사와 검증 범위를 기록합니다. (K727)

- TypeScript 위반 fixture마다 명시한 소유 검사 단계만 실행하고 기존 진단 단언 및 실제 전체 파이프라인의 정상·실패·라우팅 검증은 유지합니다. (K726)
- native autoload lint의 PHP 파서 의존성을 선언하고 잘못된 저장소의 실패를 Git 버전별 문구 대신 실제 Git 진단과 비교합니다. (K725)
- 필요한 CI shard의 PHP·Composer·Go·Python·PHP 추출기 설치를 보완하고, 금지 입력 fixture를 이동한 뒤에도 실제 금지 입력 거부 규칙을 유지했습니다. (K724)
- TOOLS 선택 설치에서 고정 버전 필수 의존성을 먼저 검증하고 다른 설치는 보존하며, 각 CI 작업이 필요한 환경만 독립적으로 준비하도록 했습니다. (K723)
- parity 테스트 파일을 두 독립 CI 작업으로 나누고 공통 fixture를 중복 없이 공유하며 132개 테스트의 이름과 본문을 각각 정확히 한 번 보존합니다. (K722)
- parity 단계 fixture 타입과 중복 블록을 수정하고 자식 Make 검사에서 부모 shard 변수를 격리해 빈 선택값 검사가 같은 CI 그룹을 재귀 실행하지 않도록 했습니다. (K721)
- parity CI를 공개 API·정적 검사와 언어별 native 실행 단계로 나누고 전체 정적 규칙 및 기본 전체 검사 동작을 유지합니다. (K720)
- 언어별 공개 API 형태를 해당 릴리스 산출물의 심볼로 검증하며 공통 동작, 실행 가능한 요구사항 추적과 전체 공개 심볼 검사를 유지합니다. (K719)
- Kit 단위검사를 CI 6개 작업으로, 소스 검사를 명시적인 9개 그룹으로 병렬 실행하며 테스트 누락·중복과 최종 성공 판정을 검사합니다. (K718)
- Nested composition, alias, visibility/precedence adaptation을 반영해 PHP trait의 유효한 공개 멤버를 사용하는 클래스에서 추출하고, internal trait 선언 자체는 숨기도록 했습니다. (K717)

- Mixed deferred-requirement 기대값을 현재 규칙에 맞추고 native PHP fixture를 다시 쓸 때 requirement marker를 보존했으며, 실패와 정리 단언은 유지했습니다. (K716)

- 명시적으로 보류한 requirement의 binding을 보존하고, 해당 unit을 실행하거나 통과 건수로 계산하지 않으며 active/deferred requirement 혼합을 거부하도록 했습니다. (K715)

- 명시적으로 선언한 모든 공개 API 입력과 crate별 Rust feature를 읽고, 일부 추출 실패를 불완전한 심볼 목록으로 승인하지 않도록 했습니다. (K714)

## 0.0.60

- 기존 Korean principles의 canonical English standards plan 링크 수정을 release에 포함했다. (K711-1)

- Cargo fetch 기대값에 provider checker lock을 포함하고 Go proof stub을 선택된 checkout tool 경로에 설치한다. Offline, 실패와 version assertion은 유지한다. (K713)

- 기존 npm, Composer, generated PHP와 wheel producer를 재사용해 committed HEAD의 tagless candidate archive를 만든다. Candidate build는 미커밋 source를 거부하며 tag 생성과 공개의 CI gate는 유지한다. (K712)

- commit은 합법적인 working-tree 전이 경로로 도달한 최종 checklist state를 기록할 수 있으며, item-state의 각 작업은 여전히 한 단계만 허용한다. 회귀 검사는 대기에서 완료까지의 commit 경로, 직접 대기에서 완료로 옮기는 작업의 거부, 완료 항목 재개방 거부를 확인한다. Retained-branch lifecycle 도구는 repository policy로 분류한다. (K708-1)

- Tag 없는 native npm candidate와 consumer lock, 최신 dependency review로 Kit 0.0.60을 준비합니다. 로컬 consumer 설치와 offline policy 검사가 통과했고 release tag는 만들지 않았습니다. (K711)

- PHP extension builder는 기존 module을 바꾸지 않고 compiler warning과 make 실패 원인을 보존한다. 임시 산출물 정리를 확인하는 집중 fake-tool regression이 1/1 통과한다. (K709-1)

- Push와 release gate가 development와 verification을 구분하고 release 또는 tag 생성 전에 verification을 요구하며 선언된 보존 branch를 유지한다. K708 집중 regression 19/19가 통과했다. 최초 release 파일 실행은 47개 통과, fixture가 Go 대신 mise shim을 찾은 환경 오류 7개였다. fixture가 `var/tools` 밖의 Go를 선택하도록 고친 뒤 해당 7개가 통과했다. (K708)

- 기존 `cargo-downloads-fetch`가 consumer의 offline lint용으로 provider의 Rust checker lock을 설치하고, Kit 자신에서 실행할 때는 같은 lock을 중복 fetch하지 않습니다. 집중 회귀 테스트 1/1이 통과했고 ORM consumer 설치는 ORM lock 세 개와 Kit checker lock을 모두 fetch했습니다. (K710)

- 기존 PHP extension CLI를 명령이나 인자를 바꾸지 않고 `@polyspec/kit/php-extension`으로 공개합니다. 출력/source-copy/configure 인자 case 1/1, packed mapping 1/1이 통과했고, 설치 archive에서 dist module import가 통과합니다(1/1). (K709)

- 다섯 shared helper API를 source와 published package의 명시적 subpath로 제공합니다. Packed manifest는 경로를 `dist`로 바꿉니다. Pack 변환 테스트 1/1이 통과했고, offline consumer 설치는 다섯 API를 모두 import해 source export와 비교했습니다(1/1). (K707)

- 예상한 native Composer 실패는 진단을 유지하면서 GitHub Actions 오류 주석을 만들지 않습니다. commit `1aa82aea27a871743a4fa81684328431aa0de99e`의 CI `make kit-test`는 예상한 세 실패(exit status 2, 2, 1)에 오류 주석을 출력했습니다. 수정 후 focused K681 regression 1/1이 통과합니다. (K706)

- Main CI의 단위 case 1,441개와 source case 187개가 모두 통과한 뒤 0.0.59를 공개한다. Release 실행 40448452188에서 tag와 draft consumer 설치를 검증한 뒤 배포를 공개했다. (K677-7)

## 0.0.59

- 각 독립 CI job의 오프라인 검사 전에 잠긴 Rust crate를 설치한다. Native Rust case 두 개는 빈 Cargo registry에서 실패하고 선언한 설치 후 통과하며, 영향받은 workflow case 세 개도 통과한다. (K705)

- 독립 CI jobs와 필수 kit summary, 잠긴 native consumer 설치 및 완전한 Python backend fixture로 0.0.59를 준비한다. Workflow 테스트 16/16, 영향받은 parity case 124/124, 실제 Python 심벌 case 1/1이 통과했다. 공개 CI와 release proof는 K677-7에서 반드시 검증한다. (K677-6)

- Python 심벌 추출은 project 조회 실패를 프로젝트가 없는 경우로 취급하지 않고 오류로 보고한다. Red: K704 누락 entry case가 project 조회 오류 대신 extractor 실행 오류를 반환했다. Green: K701 package discovery case와 함께 K704가 통과한다(각 1 case). (K704)

- File URI 경로 검사는 잘못된 URI의 기존 fallback 동작을 유지하고 예상하지 못한 parser 오류를 다시 던진다. Red: K699 회귀 테스트가 예상하지 못한 parser 오류를 받아들였다(1 test). Green: 회귀 테스트가 통과한다(1 test). (K703)

- Parity binding은 기본 native reporter를 대체하지 않고 runner 인자를 추가할 수 있습니다. 서로 다른 인자를 가진 binding은 별도로 실행하며 `command`와 binding `args`는 함께 쓸 수 없습니다. Red: K702 regression은 선언되지 않은 binding 인자로 실패했습니다(1 test). Green: 테스트가 통과합니다(1 test). (K702)

- Python 심벌 추출은 setuptools 패키지 발견 설정을 따르고 선언된 패키지 선택에서 제외된 생성 모듈을 빼낸다. K701 fixture는 수정 전 제외 모듈을 노출해 실패하고 수정 후 통과한다(1 test). ORM 소스 추출 결과는 심벌 673개이며 생성 모델 심벌은 없다. (K701)

- 정적 선언 검사는 모든 구현을 계속 확인하면서 parity 실행은 구현을 선택할 수 있습니다. 빈 선택, 알 수 없는 구현, 실행할 바인딩이 없는 선택은 실패하고 기본 실행은 모든 바인딩을 유지합니다. Red: Go를 선택해도 다섯 구현이 모두 실행되는 것을 K700 테스트에서 확인했습니다. Green: K700 테스트가 통과합니다(1 test). (K700)


- Parity declaration path 검사에서 non-file URI 값은 보존하고 file URL runner 경로는 checkout 탈출 여부를 확인한다. (K699)

## 0.0.58

- provider lint와 descendant cleanup 수정 후 kit 0.0.58 consumer lock과 advisory review를 갱신했다(K677-5).

- TypeScript lint가 설치된 provider에서 선언된 tool 실행 파일을 해석하고 native type-aware backend bin directory를 제공한다. Linked, nested, hoisted 설치에서 consumer가 bin link를 만들지 않으며 catch-step fixture도 같은 native dependency를 선언한다. (K698)

- descendant가 SIGTERM에서 pipe만 닫아도 process group cleanup이 끝난 뒤 command 결과를 반환한다. 회귀 검증은 system reaper를 기다리는 종료된 zombie를 허용하고 실행 중인 descendant는 거부한다(K430-2).

- Composer 개발용 path lock과 정확한 다중 심벌 API binding, native consumer lock 및 보안 권고 검토를 포함한 kit 0.0.58을 준비했습니다. (K677-4)

- API binding은 기존 단일 symbol 또는 비어 있지 않은 고유 공개 symbols 목록을 받습니다. R1은 모든 항목을 검사하고 R11은 선언된 전체 표면을 대조하며 중복 implementation binding은 계속 거부합니다. (K697)



## 0.0.57
- Composer development lock은 두 dependency section의 external polyspec path package를 허용한다. 설치된 source link는 별도로 검사하고 release consumer lock은 release archive URL을 기록해야 한다. Local path release regression은 기존 거부 동작을 검증한다 (K696).

- 짧은 PHPUnit class id는 namespaced test class의 정확한 class-name 경계에서 매칭하며 FQCN, bare method와 provider data set의 선택은 정확히 유지한다. Red: K695 regression은 생성된 filter에 PHPUnit이 요구하는 namespace prefix가 없어 실패했다. Green: K695 unit 1개, 변경 파일 type-aware oxlint와 docs-check가 통과한다 (K695).

- 격리 PHP parity 실행기 수정과 갱신된 native consumer lock 및 의존성 검토를 포함한 kit 0.0.57 공개를 준비했습니다. (K677-3)

- PHP extension parity는 기존 격리 Composer library-test autoloader를 사용하고 확장 인수를 유지하며 두 실행 또는 support-file 실패 뒤 임시 설치를 정리합니다. 순수 library 실행과 명시적 command binding은 기존 실행을 유지합니다. (K677-2)

- parity 회귀 테스트는 성공과 실패 실행 모두에서 정리를 검증하며 library vendor directory를 그대로 유지합니다. (K677-2)
- Composer development lock은 두 dependency section의 external polyspec path package를 허용한다. 설치된 source link는 별도로 검사하고 release consumer lock은 release archive URL을 기록해야 한다. Local path release regression은 기존 거부 동작을 검증한다 (K696).

- 짧은 PHPUnit class id는 namespaced test class의 정확한 class-name 경계에서 매칭하며 FQCN, bare method와 provider data set의 선택은 정확히 유지한다. Red: K695 regression은 생성된 filter에 PHPUnit이 요구하는 namespace prefix가 없어 실패했다. Green: K695 unit 1개, 변경 파일 type-aware oxlint와 docs-check가 통과한다 (K695).

- Rust parity runner는 explicit manifest path가 지정한 Cargo target을 선택하고 기존 `tests/<name>/main.rs`의 sibling module을 해당 target에 연결한다. 일반 `tests/<name>.rs`와 library fallback은 유지한다. Red: K694는 명시된 integration binary와 그 test module에 `--lib`를 선택했다. Green: K148과 K694 (test 2개), typecheck, 변경 파일 type-aware oxlint 및 docs-check가 통과했다 (K694).

- PHP feature 바인딩은 파일에 함께 묶인 정확한 method만 실행한다. Bare 및 qualified method id, FQCN과 provider data set에 escaped PHPUnit filter를 적용하며 parity ledger는 선택한 모든 id의 실행을 계속 요구하고 선택하지 않은 test failure는 무시한다. Red: K692 regression은 공유 파일의 선택하지 않은 실패 method 때문에 실패했다. Green: 정확한 K692 unit 1개, 변경 파일 oxlint와 docs-check가 통과한다 (K692).

- 기존 regression test에서 얻은 유효한 Red 결과를 인용하면 fix commit 자체가 test 파일을 변경하지 않아도 된다. Red 또는 No-Red가 없거나 잘못되면 계속 거부하며, 집중 commit unit은 유효한 Red와 기존 No-Red 경로를 모두 확인한다. Red: K693 source-only fix regression이 a6a485e8에서 실패했다. Green: K693 unit 1개, 변경 파일 oxlint와 docs-check가 통과한다 (K693).

- CI 승인은 앞선 전체 실패 보고서와 최종 성공 실행 40366841110을 보존한다. 전체 44단계, kit 1425개와 source 182개가 실패·timeout·skip 없이 통과했다. Release 검증은 공개된 annotated v0.0.56 tag를 별도로 승인하며 수정마다 로컬 전체 suite를 반복하지 않았다 (K686).

- Kit 0.0.56은 자체 CI 44단계(kit 1425개와 source 182개, 실패·timeout·skip 없음)와 release 실행 40371683313의 archive 생성, 외부 consumer proof 및 공개를 통과하여 공개됐다. Annotated tag와 asset은 GitHub Release에서 사용할 수 있으며 실패한 0.0.55 tag는 변경하지 않았다 (K677).

## 0.0.56

- Native advisory review는 개발 root lock과 별도로 해석한 npm release-consumer lock을 함께 포함한다. Red: 감사 범위를 선언하면 누락된 review entry가 드러난다. Green: native review가 consumer에만 있는 전이 version 네 개를 포함해 현재 여섯 lock을 advisory 없이 기록하고 예외 추가 없이 offline dependency gate가 통과한다 (K677-1).
- 이 version은 공개되지 않은 0.0.55 candidate의 native source/worktree package 관리, 선택적 설치 package bootstrap, runner 정리와 dependency review 변경을 포함한다. Asset gate가 정상 prepack 변환을 거부한 기존 tag는 보존하고 수정한 validator를 여기에 포함한다 (K677).

- Parity ledger는 잘못된 reporter 출력을 해당 바인딩의 R3 실패로 기록하고 나머지 suite 및 feature 바인딩을 계속 실행한다. node reporter parser의 strict 검사는 유지한다. Red: 선택한 K691 unit은 `exit 0` line에서 바인딩 반복을 중단했다. Green: K691 regression 1개와 docs-check가 통과한다 (K691).
- Kit release archive 검증은 source export와 native hook bin의 정식 prepack manifest 변환을 공유한다. 이름, 버전, dependency, script를 포함한 나머지 모든 byte를 tag source와 비교하며 다른 npm 및 Composer manifest는 기존 byte-exact 비교를 유지한다. Red: b343be7a에서 정상 변환된 kit manifest가 assets 검증에 실패한다. Green: 예상 밖 kit manifest 변조 6종과 기존 일반 package 변조 검사를 포함한 선택 release/prepack unit 5개, 변경 파일 type-aware lint 및 docs-check가 통과한다 (K686-6). 기존 실제 packed-consumer case의 단일 native pack을 release.assets로 실행하고 같은 tarball을 설치하며 추가 build나 pack 없이 선택 source 실행이 167.6초에 통과했다.

## 0.0.55

- npm source-link fixture는 일반 provider 식별자를 사용하며 transitive graph 선택, 모든 dependency 선언 section, override, source link 멱등성과 상위 workspace 해석을 유지한다. 제품 코드와 저장소 격리 규칙은 변경하지 않는다. Red: 90c812ec에서 isolation naming case가 실패한다. Green: 해당 case와 선택 npm case 3개, 변경 파일 type-aware lint 및 docs-check가 통과한다 (K686-5).

- Native link fixture는 기존 환경의 source-only 계약에 따라 locked sync 없이 선택 provider를 한 editable transaction으로 전달하고 명시적 extra와 정확한 source 경로를 검증하며 --no-deps를 사용하지 않는다. uv fixture는 모든 editable argv를 읽고 dependency를 해석하지 않고 extra와 경로만 분리한다. 공유 소유 파일 실행에서 worktree Python 환경 누락과 상대 link 표현을 강제하는 낡은 기대를 확인해 환경을 준비하고 npm 심볼릭 link, 정확한 provider, read-only 진단 성공과 선언 불변을 검증하도록 맞췄다. 로컬 Red: 0c100506의 K657-3은 이전 stub가 [extra]를 directory 일부로 취급해 실패한다. Green: K657-3이 통과했으며 소유 파일 1회는 72개 통과와 2개 실패를 수집했고 두 실패 case는 fixture 수정 후 선택 재검증에서 통과한다. 변경 파일 type-aware lint와 docs-check가 통과하며 이 로컬 증거로 미수집 CI 실패 원인을 단정하지 않는다 (K686-4).

- Go 워크트리 실제 검사는 로컬 kit 의존성을 선언한 소비자를 네이티브 오프라인 npm 설치로 준비하고 두 setup 호출에 고정 npm 명령을 전달한다. 수동 설치 패키지 링크를 제거하면서 기존 Go 워크스페이스, 미릴리스 모듈, 반복 연결 및 main 격리 단언을 모두 유지한다. K690에서 이 fixture 전환을 놓쳤으며 소유 실제 검사는 수정 전 실패하고 수정 후 통과한다 (K690-1).

- 최종 candidate 자체를 새 native offline worktree 경로로 준비했다. 공유 cache에서 npm과 두 Composer project를 설치하고 link-state-check가 통과했으며 두 working tree의 tracked 변경은 없었다. 이 준비는 product rebuild나 전체 test suite를 실행하지 않았고 candidate 전체 CI와 공개는 별도 승인 단계로 남는다 (K655).

- Worktree 준비는 main project의 실제 cache와 선언된 root URL 정책을 사용하는 native offline npm ci에 dependency tree 생성을 맡기고 기존 native npm helper로 source를 다시 연결한다. Composer는 공유 native 환경/cache와 선택된 manifest/vendor 설정을 사용하여 package, record, bin, autoload를 직접 만들며 legacy projection은 main link를 따라가지 않고 제거하고 고정 archive 입력은 설치 전에 filesystem copy/clone으로 준비한다. 도구 재사용과 uv 동작은 유지하며 저장공간 비용을 명시한다. Red: d3d16d3a에서 native 준비 unit 2개가 실패한다. Green: 고유 소유 unit 18개와 작은 실제 npm/Composer worktree case가 통과하며 main byte/lock 불변, cache-only 반복 동작, type-aware lint, typecheck, docs-check를 검증했다(K690).
- Package test 준비는 격리된 여섯 native install/build 소비자와 기존 process별 primed download cache를 유지한다. Dependency root test는 실제 소유 계약을 명시하고 source export 주석은 checkout import와 packed dist import를 구분한다. 검증: helper와 세 caller 파일을 검토했으며 동작과 단언은 바뀌지 않아 문구 수정에 비싼 package test를 재실행하지 않는다 (K678). make docs-check도 통과하여 검토를 완료했다.
- Python source 연결은 기존 native 환경을 전제로 release lock을 재조정하지 않고 선택 editable을 연결한다. 명시적인 uv installer는 공통 native source backend 전에 locked sync를 유지하므로 새 로컬 dependency를 개발 lock 수정이나 합성 없이 연결할 수 있다. Red: 47436bb6에서 source 연결이 먼저 오래된 release graph를 해석해 K689-3이 실패한다. Green에서는 선택 unit과 기존 환경 실제 검사가 통과하고 locked installer는 오래된 lock을 계속 거부하며 변경 파일 type-aware lint도 통과한다 (K689-3).
- Python source 설치는 알려진 로컬 runtime dependency 이름을 따라가 명시적 root requirement extra와 함께 선택 editable을 하나의 native uv transaction으로 전달한다. uv가 일괄 --no-deps 없이 호환되는 외부 dependency를 해석하며 native dependency, source 경로와 선택 provider 완전성 검증은 유지한다. Red: 7f1c091d에서 개발 beta가 요구하는 미발행 로컬 child와 cache의 setuptools가 설치되지 않아 K689-2가 실패한다. Green에서는 선택 unit과 실제 native 검사가 release URL/hash lock 불변 및 child source 수정의 즉시 반영을 포함해 통과하고 변경 파일 type-aware lint도 통과한다 (K689-2).

- Release candidate는 native Python editable overlay와 platform 진단 처리를 포함하며 선택 provider 누락과 제어 흐름 회귀를 보완합니다. Lint cleanup 실패에도 기존 진단과 후속 검사를 유지합니다. 후속 수정은 각각 선행 등록한 child와 소유 검증을 기록합니다(K655).

- 수정된 0.0.55 candidate는 native 소유권·advisory·target 격리·process 정리 수정을 포함합니다. 새 online native review가 정확한 다섯 lock을 검토해 advisory가 없음을 확인했고 새 tool version 안내는 정보로 유지합니다. 소유 검사는 위에 기록하며 candidate CI 통과와 consumer proof를 거친 공개는 대기 중입니다(K655).
- 사전 빌드 부모가 종료하면 출력 배출을 기다리면서 기존 프로세스 그룹 정리를 실행해 파이프를 잡는 자식이 완료를 막지 못하게 한다. 집중 빌드 고아 파이프·빌드 실패 사례와 변경 파일 타입 인식 lint·typecheck가 통과한다 (K682-1).
- 테스트 도구의 정상 종료도 사례·간격 제한시간을 기다리지 않고 같은 정리를 실행한다. 집중 고아 파이프 사례는 활성 그룹 프로세스를 남기지 않으면서 종료 0·마지막 출력·통과 사례 수를 보존한다. 시간 초과·중단·부모 종료 정리 검사도 통과한다 (K682-2).
- Candidate 상태는 완료된 native 소유권 수정 및 CI 실패 owner 네 건의 수정과 아직 필요한 candidate 전체 CI·공개를 구분한다. 조정 당시 legacy worktree dependency projection과 기존 land timeout은 완료로 주장하지 않고 K690/K685에 배정했으며 이후 구현과 소유 검사 증거는 별도로 기록한다 (K679).
- Source helper와 release 설치의 native 검증 경계를 명시했습니다. Release bootstrap에는 sibling checkout이 필요 없고 source용 npm-install은 선택한 개발 provider가 필요하며 readonly link 검사를 모든 peer/version 검증으로 간주하지 않습니다. Resolver나 새 runtime 강제는 추가하지 않았습니다(K683).
- 실행 결과 입력 지문은 기존 Git 파일 목록을 사용해 루트 선택자 `.`을 추적 파일과 새 비무시 파일 전체로 해석한다. 무시된 출력은 제외하고 존재하지 않는 입력 경로는 계속 실패한다. --inputs 없이 --results를 지정한 선택 CLI 실행은 실제 통과 보고서를 작성한다. Red: 1a31679b에서 루트·보고서 회귀 두 개가 실패했다. Green: 소유 지문·보고서 사례 세 개와 변경 파일 타입 인식 lint가 통과한다 (K687).
- Cargo source 명령, Make recipe와 standalone test runner는 상속된 CARGO_TARGET_DIR를 제외하고 명시적 native target 인자와 나머지 환경은 유지한다. Native metadata로 crate 컴파일이나 Cargo.lock 변경 없이 main과 Git worktree가 서로 다른 기본 target을 선택함을 확인한다. Red: d83b6c61에서 target 격리 소유 case 4개가 실패한다. Green: 해당 4개와 source/holder/locked-graph 회귀 5개가 통과하며 변경 파일의 type-aware lint와 typecheck도 통과한다(K676).
- Dependency review update는 Composer provider entry, scratch manifest, version override와 update 전후 lock metadata 보정을 합성하지 않고 native 명령을 실행합니다. 앱이 선택한 manifest와 선언한 repository는 native 입력으로 유지하며 해석 실패는 lock을 바꾸지 않습니다. 폐기된 provider-entry 진입점은 native 전환 안내와 함께 실패합니다. 합성 전용 case 14개를 native 소유권 회귀 검사 5개로 대체해 graph 해석, 전이/path/VCS 선언, 실제 version, platform 실패, 반복 lock 안정성과 release-lock 경계를 검증합니다. Red: e6475a05에서 native validation 실패 전에 앱 lock metadata가 변경됐습니다. Green: 선택 review/update case 12개, advisory/gate case 2개, type-aware lint와 docs-check가 통과합니다(K681).
- Online dependency review는 native npm audit의 offline mode를 명시적으로 끈다. Audit payload는 vulnerabilities를 포함하고 native error discriminator를 포함하지 않아야 하므로 transport 실패가 성공 review를 빈 finding으로 덮지 못한다. 격리 cache와 닫힌 loopback endpoint를 사용한 pinned native npm 실험은 상속된 offline mode가 거짓 zero를 반환하고 명시적 online audit는 실패함을 확인한다. Red: c960e2fa에서 소유 경계 case 실패; Green: 선택한 경계·취약점·빈 출력·schema unit 및 native 실험 통과; typecheck와 변경 파일 lint 통과. Offline gate는 계속 committed review만 읽는다 (K684).
- npm advisory review는 영향받는 native audit node path와 해당 locked copy의 정확한 version을 보존한다. 취약한 nested copy 대신 안전한 top-level copy를 기록하지 않으며 node version을 알 수 없으면 native range를 유지한다. Review와 offline gate finding은 영향받는 node를 표시한다. 기존 lock/package/advisory exception은 개별 path가 아니라 일치하는 모든 copy에 적용된다. Red: 80a3a877에서 nested-copy case가 안전한 top-level 8.3.4를 기록; Green: 선택한 귀속·fallback·schema case, typecheck 및 변경 파일 lint 통과 (K680).
- Go·Cargo 사전 테스트 빌드는 전체 작업 시간 제한이 없다. 실행기는 명령 시작·실시간 출력·종료 상태·경과시간을 기록하고 실패한 빌드 이후 테스트를 실행하지 않는다. 사례별 제한시간·취소·부모 종료 감지·프로세스 그룹 정리는 별도로 유지한다. Red: e7fc0116에서 가상 시계 진행 경계 검사가 실패했다. Green: 빌드 소유 사례 네 개와 시간 초과·중단·부모 종료 정리 사례 세 개, 변경 파일 타입 인식 lint·typecheck가 통과한다 (K682).
- Python editable source 검증은 선택한 로컬 provider가 native 설치 distribution 목록에 없으면 빈 목록과 무관한 package만 있는 목록을 포함해 실패한다. 기존 실경로 검증을 유지하고 미사용 provider와 정상 release-only 설치는 강제하지 않는다. Red: 87b23676에서 K689-1 검사가 예상 exception 누락으로 실패했으며 Green에서는 선택 소유 unit과 변경 파일 type-aware lint가 통과한다. 이 수정은 transitive, 미발행 package, marker 선택 검증 범위를 확대하지 않는다 (K689-1).

- Warning metadata는 warning 호출 결과가 무시될 때만 진단으로 봅니다. 조건·대입 값·반환 predicate로 소비하는 호출은 platform finding으로 유지하며 기존 진단 warning과 직접 platform/architecture 분기 검사를 보존합니다. Red: e3ff712d에서 결과 소비 회귀 검사 3개가 모두 실패했습니다. Green: 선택 divergence case 4개와 type-aware lint가 통과합니다(K688-1).
- 소유 임시 directory cleanup이 실패해도 lint step은 원래 도구 출력과 exit 실패를 유지하고 cleanup을 step 실패로 보고하며 다음 step을 실행합니다. 권한에 민감한 fixture 대신 deterministic cleanup seam으로 도구 성공과 실패를 검증합니다. 원래 PHPStan cleanup commit 83a07531은 부모 K686을 사용했으며 K686-3은 그 후 이번 후속 구현 전에 등록했습니다. Red: 15162952에서 cleanup 소유 case 2개가 실패했습니다. Green: 선택 lint case 4개와 type-aware lint가 통과합니다(K686-3).
- land는 기존 명령 실행기로 Make·rebase·merge·워크트리 제거를 await하며 전체 Make 시간 제한을 두지 않는다. 명령 시작·실시간 출력·결과·경과시간을 표시하고 부모 종료·프로세스 그룹 정리를 유지하며 main 비교 잠금은 게이트 await 동안 유지한다. 문서 검사는 진단과 기본 프로그래밍 출력을 유지하면서 단계 진행을 보고한다. Red: a4db4dc7에서 실시간 게이트 출력 사례가 시간 초과했다. Green: land 소유 사례 26개·문서 진행 사례·변경 파일 타입 인식 lint·typecheck가 통과한다 (K685).
- Local Python provider는 locked sync에서 해당 release wheel 설치만 제외한 뒤 uv의 native editable 동작으로 설치한다. Release URL, hash와 lock은 유지하며 offline fixture가 환경이 선언된 source를 import하는지 확인한다(K689).
- divergence checker는 `process.platform`과 `process.arch`가 warning metadata에 쓰일 때만 무시하고 runtime 분기 탐지는 유지한다. Red: 16ecc178에서 K688 focused case가 실패했다. Green: 수정이 commit된 tree에서 `make item-test ID=K688`가 통과한다(K688).
- 과거 bootstrap 기대는 소비자 Node·네이티브 npm bin hook의 정확한 명령, 실행 가능한 소스와 packed dist 명령 대상 및 동일한 설정, Make 이전 설치 패키지 workflow를 검증한다. workflow 검사는 기록용 npm fixture를 재사용해 설치·빌드 없이 정확한 npm 선택과 kit 자체 소스 예외를 보존한다. Red: 380a23a5에서 이전 경로 기대 세 개가 실패했다. Green: 선택한 소유 사례 세 개와 변경 파일 타입 인식 lint가 통과한다 (K686-2).
- npm provider 선택 fixture는 전이 graph 탐색 전에 기존 provider helper로 manifest를 포함한 각 source package를 생성한다. 선택 단언은 그대로 유지하고 제품 코드는 바꾸지 않는다. Red: 77eb86c8의 소유 case는 transitive package.json 누락으로 실패했다. Green: 완성된 native package 입력으로 해당 선택 case가 통과한다(K686-1).
- 기존 미완료·폐기 checklist 31개 전체를 현재 code와 결정에 대조했습니다. 과거 ID를 보존하고 통합 공개 선행 조건을 폐기했으며 합성 link 문구를 native 소유권 규칙으로 대체하고 실제 결함은 K680–K686에 등록했습니다. Code와 test 읽기 검토는 실행 검증과 구분하며 K671의 구현 시점 등록도 명시합니다(K679).
- Release 인계는 native source link 소유권, 대체된 sibling bootstrap, 구현 증거와 공개 release 승인을 구분합니다. CI 실패 시 release checklist는 미완료로 유지하고 공개된 0.0.55 tag 밖의 변경은 후속 version과 별도 검증을 거칩니다. Local link 문서는 npm lock 읽기를 유지합니다. Cargo target 상속과 package test 준비 비용은 명시적인 후속 작업으로 남깁니다(K675).
- npm idempotence는 Node가 실제로 검색하는 경로를 확인하므로 workspace package는 상위 `node_modules`의 올바른 source link를 재사용한다. source path가 없거나 다른 link에 가려지면 native npm linking을 계속 실행한다(K674).
- 선택한 설치 provider가 모두 source로 resolve되면 반복 local npm link는 아무 변경도 하지 않으며, 잘못되거나 누락된 source는 native npm link로 복구한다. Release URL override가 있는 offline source graph와 잘못된 target 복구 case가 통과한다(K673).

- Transitive npm graph fixture의 package 이름·경로·release URL을 일반 editor, language, storage, codec 이름으로 바꾼다. Dependency edge, workspace 배치, release override와 정확한 source assertion은 유지한다. Red: 377c06b1에서 제품별 이름으로 isolation이 실패한다. Green: isolation과 선택한 K672 selector/native graph 검사가 통과하며 변경 파일의 type-aware lint도 통과한다(K672-1).
- Cargo fallback fixture는 native offline update preflight를 허용하고 source 거부 시 요청한 command가 실행되지 않으며 holder가 해제됨을 구분해 검증한다. Red: cdb95b63에서 소유 fallback case 실패; Green: 선택한 Cargo source case 4개 모두 통과 (K671-8).

- Rebuild inventory에 native Cargo metadata source helper를 분류하고 현재 npm과 uv 설치 명령을 설명한다. Dependency, document, generated-file, link-state 및 npm test의 package·경로·URL fixture를 일반화하며 isolation과 원래 의미 assertion은 유지한다. Red: 89ee79f8에서 분류와 isolation 소유 case가 실패한다. Green: 선택한 소유 case 26개가 통과한다(K671-5).
- 설치 package bootstrap 통합을 완료했습니다. Source link는 선택 사항이고 공유 파일은 package가 제공하는 일반 사본이며 release/gates는 package 우선 설치를 사용합니다. 소유 workflow, native source/packed hook, copy, npm, rule 검사가 통과했습니다. 유지한 tokenizer 수정으로 PHP extension 소유 검사 25개도 통과했습니다. Main CI와 release 공개는 대기 중입니다(K671).
- Worktree link fixture는 자체 Composer vendor-directory 응답과 준비된 native Python source 선언을 포함한다. Missing make target 판별은 GNU make diagnostic의 두 quote 형식을 허용하고 missing prerequisite와 다른 make 실패는 계속 오류로 처리한다. Red: 76a52fa8에서 worktree case와 GNU make 4 K583 case 실패; Green: 선택한 link case 4개, 실제 GNU make 4 K583 unit, typecheck 및 변경 파일 type-aware lint 통과 (K671-7).
- Native npm 연결은 package-lock 읽기를 끄지 않는다. Offline으로 설치된 registry range는 기존 native tarball resolution을 사용하고 registry를 다시 조회하지 않는다. --no-save는 release manifest와 lock을 유지한다. legacy-peer-deps 우회는 추가하지 않으며 올바른 source의 멱등 재사용은 K673/K674가 정의한다. Native npm link는 호환되지 않는 linked peer를 허용할 수 있으며, 소유 fixture는 npm ls가 이를 탐지함을 기록하고 별도 resolver나 설치 gate는 추가하지 않는다. Red: 89ee79f8에서 locked-range case가 ENOTCACHED로 실패했다. Green: locked-range·peer 관찰·기존 release-to-source case와 변경 파일 type-aware lint가 통과했다(K671-6).
- Bootstrap 문서와 규칙은 설치된 package path와 일반 공유 사본을 사용하고 선택적인 native npm source link를 유지합니다. Native npm lock은 hook command를 기록합니다. Workflow unit 16개, rule unit 13개, 문서 및 rule 검사가 통과합니다(K671).
- Python link는 polyspec dependency를 선언하지 않은 project에서 주변 uv workspace를 sync하지 않습니다. 소유 unit은 14c67f38에서 실패하고 guard 추가 후 통과합니다(K670-4).
- Release version commit은 manifest와 lock metadata를 허용하되 chore(release)에 구현 변경을 허용하지 않습니다. 소유 unit은 14c67f38에서 실패하고 수정 후 통과합니다(K670-3).
- install-packages 단위 fixture는 bootstrap과 kit.mk를 node_modules/@polyspec/kit 아래에 준비하고 그 설치 패키지 경로를 include한다. dry run은 소스 연결 없이 릴리스 잠금의 npm ci 호출을 계속 검증한다. Red: 89ee79f8에서 단독 bootstrap fixture는 kit.mk가 없어 실패했다. Green: K511 사례 한 개와 변경 파일 타입 인식 lint가 통과한다 (K671-4).
- release와 gates는 Make 실행 전에 정확한 packageManager npm으로 consumer package lock을 bootstrap하며 이 단계에서는 lifecycle script를 실행하지 않고 이후 정식 toolchain과 package lifecycle 설치를 따른다. kit 자체는 source Makefile을 사용하고 자신의 published copy 설치를 건너뛴다. gates는 표준 root checkout을 사용하며 install, native link와 모든 gate target을 유지한다. floating 또는 tag 기반 형제 source clone은 제거했다. 기존 workflow 검사 13개가 통과했고 consumer 명령 인자, 명시적 cache, kit skip을 포함한 새 package-first 실행 및 root-layout 검사 3개와 변경 검사 파일 type-aware lint가 통과한다 (K671-3).
- 설치된 kit bootstrap은 필수 형제 체크아웃 없이 네이티브 npm 소스 링크와 패키지 설치를 지원한다. npm이 polyspec-kit-hook 명령 링크를 소유하고 prepack은 소스 대상을 dist로 바꾸며 Claude 설정의 소비자 로컬 명령 바이트는 동일하다. pack 소유 단위 검사 두 개와 실제 소스·패키지 소비자 사례 한 개가 명령 허용과 hook 거부까지 통과한다. 변경 파일 타입 인식 lint와 typecheck도 통과한다 (K671-1).
- 공유 principle, editor 설정, Claude 설정, release/gates workflow는 설치된 kit package의 regular copy로 관리합니다. sync는 bytes가 같아도 managed symlink를 atomic하게 교체하고 provider를 그대로 유지하며 반복 실행은 변경을 만들지 않습니다. tracked shared link의 sibling-checkout 예외를 제거하고 소비자 정리 전에 kit source checkout의 sync를 거부합니다. Red: 이전 동작에서 선택 copy-policy case 4개가 실패합니다. Green: 소유 case 4개와 type-aware lint가 통과합니다(K671-2).
- npm source 연결은 선택한 provider의 전이 local npm dependency를 따라가며 consumer link 중 workspace 전체 재해석을 비활성화한다. 따라서 workspace override가 release URL을 지정해도 연결한 package의 dependency graph가 local source를 사용한다. 선택기 단위와 offline native npm fixture가 통과한다(K672).
- Arginfo 생성이 선언한 PHP configuration을 유지한다. -n으로 비활성화하면 shared module로 로드하는 PHP 설치에서 tokenizer가 사라졌다. Red: -n이 tokenizer를 제거하면 K670-1 unit이 실패하며 green: fixture header를 생성한다(K670-1).
- Cargo source 연결은 metadata와 요청 command 전에 생성된 개발 lock에서 잠긴 sibling crate만 offline 갱신한다. Red: metadata가 호환되는 v0.0.10 sibling 대신 cache의 ordered-json v0.0.9 release를 선택했다. Green: K664-3-1 회귀와 native offline locked metadata 실행이 local source를 선택하고 tracked release lock은 유지한다(K664-3-1).

- 릴리스 준비는 Composer 소유자 수정 이후 0.0.55 npm 아카이브를 다시 빌드하고 그 새 아카이브에서 네이티브 소비자 잠금을 다시 생성한다. 아카이브 바이트는 달라지고 의존성 그래프와 소비자 잠금은 바뀌지 않는다. 새 검토는 현재 잠금 다섯 개를 취약점 없이 검토하며 dependency-policy-check·release-versions·docs-check가 통과한다. main CI와 게시는 아직 대기 중이다 (K666).
- PEP 751 unlink 검사는 uv.lock 없이 source-link sync를 수행하는 대신 이미 설치된 native editable metadata를 fixture로 명시한다. unlink의 고정 release와 interpreter 요청 검증은 유지한다. Native source 연결에는 앱 uv.lock이 필요하며 pylock.toml만으로 새 source 설치 모드를 제공하지 않는다. Red: 기존 setup은 uv sync --locked를 예상 밖에 실행한다. Green: K401-1 단일 case와 변경 파일 type-aware lint가 통과했다(K666).
- 공유 링크 fixture는 check 모드에서 누락·잘못된 source 거부를 유지하고 변경 모드에서 native 최초 설치·복구를 기대한다. Red: be6d847e에서 K529·K643·K590 세 case가 실패한다. 계약 정정 후 K529·K643은 통과했다. K590은 Composer root 소유권을 유지하고 member-local npm 설치를 명시적으로 제거해 root fallback·source 누락 진단·native 복구를 검증한 후 통과했다(K666).

- 릴리스 준비는 현재 0.0.55 소스를 네이티브 npm으로 패킹하고 그 아카이브에서 소비자 잠금을 다시 생성한다. 패키지 의존성 선언은 네이티브 소비자 잠금 항목과 같고 현재 의존성 검토는 정확한 잠금 내용 다섯 개를 취약점 없이 검토한다. dependency-policy-check와 release-versions가 통과한다. 게시와 main CI 승인은 아직 대기 중이다 (K655).
- Native tool fixture와 CI 입력 선언은 지원하는 Go, PHP, Git, dependency review, module 경로와 workspace hook 계약을 다룬다. 각 소유 검사는 통과했고 전체 CI 검증은 release gate로 남는다 (K661).

- npmSourceFolders는 설치가 없어도 dependencies·devDependencies·optionalDependencies·peerDependencies에 선언된 제공자를 선택하고 이미 설치된 전이 제공자도 보존한다. 네이티브 npmLink의 입력만 선택하며 설치 기록이나 합성 잠금을 쓰지 않는다. 선택기 단위 검사와 실제 미출시 소스 설치가 통과하고 타입 인식 lint·typecheck도 통과한다 (K664-5).
- 네이티브 npm 소스 테스트는 main과 워크트리에 로컬 0.0.1 릴리스를 설치한 뒤 npmLink로 워크트리만 0.0.2 소스를 사용하게 한다. 두 번 연결한 설치 관찰 상태가 같고 이후 소스 수정은 재연결 없이 반영되며 양쪽 릴리스 manifest·잠금, 제공자 manifest와 main은 바뀌지 않는다. 실제 npm 소유 사례 1개와 타입 인식 lint가 통과한다. npm 래퍼 동작은 변경하지 않는다 (K664-5).
- Cargo 개발 command는 요청한 command를 실행하기 전에 native metadata가 선택한 workspace source를 확인하고 형제 release로 fallback하면 native path 또는 호환 requirement 안내와 함께 실패한다. Holder lock은 lock 복사부터 metadata와 command 종료까지 유지되어 동시 writer를 거부하고 실행 argument는 보존한다. Metadata의 일반 graph option은 feature, manifest, config, offline mode와 target filtering을 전달하며 package 실행 범위는 별도 native 동작이다. Target-directory 상속은 변경하지 않아 별도 isolation 후속이 필요하다. Red: 8684ef0a에서 fallback과 동시 writer case 실패; Green: 소유 unit 10개와 source 및 lock 반복 확인을 포함한 native 미출시 path case 1개 통과 (K664-3).
- Go source 연결은 workspace와 checksum 상태를 삭제하는 대신 go work edit로 native go.work use 지시문을 정합화한다. Worktree 준비는 local 상태를 최초에만 복사하며, 상위 tracked workspace에서 상속한 경로를 포함해 main checkout의 module 경로를 자기 source로 해석한다. 실제 Go fixture는 provider 편집, 새 미출시 module, 반복 link/setup 상태와 main source/manifest/sum 불변을 검증한다. Red: 86fa740f에서 복사된 절대경로 workspace에 worktree module이 없어 프로그램이 실패한다. Green: native case와 소유 Go unit case가 통과한다(K664-4).
- Shared link는 누락 folder 검사 전에 선언된 npm과 Composer source를 native 설치하므로 최초 설치에서도 설치 folder와 record를 만들고 package 부재를 잘못 보고하지 않는다. 통합이 없으면 실패하고 통합 후 통과하는 소유 회귀로 확인했다 (K664).
- Python 개발 설치는 앱의 source/workspace 선언으로 native uv sync --locked를 한 번 실행한 뒤 uv pip check로 설치된 distribution을 검사한다. 기존에 설치되지 않은 선언 library도 포함하며 설치 목록 필터나 kit 생성 manifest, version, distribution metadata를 사용하지 않는다. virtual project를 포함한 source 해석은 native uv가 결정하며 pip check는 virtual root가 아닌 설치된 distribution을 검증한다. unit 3개와 실제 uv 검사 1개가 release에서 개발 source 선택, 새 library 설치, 반복 상태, source 수정의 즉시 반영, 설치된 consumer의 exact-version 실패를 확인했고 변경 파일 type-aware lint도 통과한다 (K664-1).
- Composer source 선택은 설치 폴더가 아직 없는 새 로컬 dependency를 포함하고 앱이 선택한 개발 manifest를 따릅니다. Composer가 native 해석으로 최초 lock을 만들고 이후 update는 로컬 package와 그 dependency로 제한합니다. 실제 native link로 배포된 0.0.1 dependency에서 호환되는 0.0.2 개발 source와 미배포 package로 전환합니다. source 수정에는 release가 필요 없으며 반복 manifest/lock/metadata/autoload 상태가 같고 호환되지 않는 exact requirement는 native 오류를 유지합니다. Red: 새 package unit은 linked 대신 locked를 반환했습니다. Green: 소유 단위/통합 case 5개와 type-aware lint가 통과합니다(K664-2).
- worktree 재빌드는 설치된 source 또는 packed kit의 공개 link export를 해석하고 workspace hook 경로는 실행 module을 따른다. source 경로 소유 검사 7개, 두 tool export fixture와 재빌드 순서 검사, 변경 파일 type-aware lint가 통과한다 (K661-9).
- Dependency isolation은 runtime import, command, peer와 별도로 native TypeScript compiler가 kit 도구에서 실제 읽은 type declaration package를 사용으로 인정합니다. 미사용 type package는 계속 거부하며 test-only import는 도구 사용으로 세지 않습니다. Red: dependency-use case가 필요한 @types/picomatch를 거부합니다. Green: 소유 isolation 3개 case와 type-aware lint가 통과합니다(K661-10).
- Parity 중복 검사는 진단 문장 전체 대신 finding 수, 공유 requirement, 충돌한 두 suite와 병합 안내를 확인한다. Python lock 검사는 uv 누락과 설치 안내를 독립적으로 확인한다. Release coverage는 앱 소유 PHP lint manifest와 kit이 쓰는 파일을 구분한다. Red: fc0fccc2에서 소유 case 3개가 실패했다. Green: 3개 모두 통과하며 변경 파일의 type-aware lint도 통과했다(K661-8).
- 의존성 계약 테스트는 버전 선택·로컬 경로·설치 형태를 네이티브 패키지 관리자에 맡긴다. 보안 게이트는 미검토 잠금 변경과 검토된 취약점을 계속 거부하며, 패키지 범위는 취약점 진단을 선택한다. Python Git pin은 review가 기록하고 전체 잠금 지문이 보호한다. fc0fccc2에서 과거 게이트 기대 7개가 실패했고 현재 계약 검사 7개와 타입 인식 lint가 통과한다. 네이티브 설치 동작의 소유 검사는 npm-install.test.mts와 composer-install.test.mts에 있다 (K661-7).
- Workspace hook 탐색은 중첩 checkout을 포함해 명시된 GitHub Actions checkout을 대화형 개발 workspace와 구분한다. Writer와 checker는 같은 판정을 사용한다. Dependency-link 검사는 유지되고 runner checkout 밖의 workspace는 누락·변조·실행 불가 hook을 계속 거부한다. Red: fc0fccc2에서 root·nested runner case가 실패한다. Green: 소유 link case 11개와 typecheck, docs-check가 통과한다(K661-6).
- Dependency review fixture는 새 release가 있더라도 advisory가 없는 완전한 review를 허용하고 새 release 정보와 update 안내 assertion을 유지한다. Red: fc0fccc2에서 소유 case 5개 실패; Green: 선택한 case 5개 통과 (K661-5).
- Git 테스트 샌드박스는 기계 기본값과 무관하게 main으로 초기화하고 명시한 브랜치 옵션은 보존한다. fixture 여섯 파일이 공통 네이티브 초기화기를 사용해 자동 유지보수를 끄고 테스트 신원을 저장소 안에 둔다. Red: c3f0a859에서 init.defaultBranch=master일 때 K524·K583·공통 초기화기 검사가 실패했다. Green: 같은 기본값에서 소유 plan·sandbox 검사 7개가 통과한다 (K661-4).
- Local-link 절차는 native source 개발과 CI의 정확한 배포 dependency 설치를 구분하고 dependency release를 독립적으로 진행하도록 정리합니다. native npm link, 앱이 선언한 Composer path repository와 개발 lock, uv editable 및 offline worktree environment를 설명합니다. 개발 규칙은 비표준 package 관리 요청의 이탈 지점을 보고하고 정석 대안을 제시하도록 명시합니다. 영어/한국어 문서는 docs-check를 통과합니다(K657).
- fresh-checkout 검증은 setup에서 설치와 build를 수행한 뒤 공개 tracked-files API를 소비하며 kit-test나 source-test를 재귀 실행하지 않는다. smoke helper는 process group 정리, 실패한 command와 양쪽 output stream을 유지한다. Red: K659 회귀 검사는 kit-test trap을 실행하여 exit 43으로 실패했다. Green: 선택한 smoke·진단 case 8개와 typecheck가 통과한다. setup 경계 통합과 디스크 공간 확보 후 실제 fresh-checkout 검증은 설치·build 54.4초, API case 0.1초, teardown 3.0초로 통과했다. 전체 실행 결과는 2 passed, 0 failed, 0 timed out이며 재귀 suite는 실행하지 않았다(K659).
- fresh-checkout 검증은 setup에서 설치와 build를 수행한 뒤 공개 tracked-files API를 소비하며 kit-test나 source-test를 재귀 실행하지 않는다. smoke helper는 process group 정리, 실패한 command와 양쪽 output stream을 유지한다. Red: K659 회귀 검사는 kit-test trap을 실행하여 exit 43으로 실패했다. Green: 선택한 smoke·진단 case 8개와 typecheck가 통과한다. runner setup 경계 통합 후 실제 fresh 설치 smoke는 npm bootstrap과 package 설치를 통과하지만 로컬 디스크 공간 부족으로 tool 설치에 실패하므로 package API 통합 검증은 남아 있다(K659).
- fresh-checkout 검증은 setup에서 설치와 build를 수행한 뒤 공개 tracked-files API를 소비하며 kit-test나 source-test를 재귀 실행하지 않는다. smoke helper는 process group 정리, 실패한 command와 양쪽 output stream을 유지한다. Red: K659 회귀 검사는 kit-test trap을 실행하여 exit 43으로 실패했다. Green: 선택한 smoke·진단 case 8개와 typecheck가 통과한다. 실제 fresh 설치 smoke는 runner의 30초 setup-gap 거부에 걸리므로 runner 통합 검증은 남아 있다(K659).
- Python worktree 환경은 명시적인 offline freeze requirements로 uv가 만들고 설치한다. main checkout 내부의 editable project 경로만 worktree로 대응시킨다. uv가 configuration, script, 설치 metadata를 관리하며 main 환경과 공유 tool cache는 유지한다. 기존 legacy 환경은 변경 전에 거부하고 설치 실패는 uv 진단을 유지한다. Red: 부모 commit에서 K533 owner test는 native requirements 기록이 없어 실패했다. Green: 선택한 Python owner test 4개와 실제 uv source test 1개가 통과한다(K657-4).
- uv는 잠긴 sync 후 로컬 Python distribution을 native editable로 설치한다. source 변경은 바로 반영되고 uv가 distribution metadata를 관리한다. 기존 package-folder link는 uv command가 source를 수정하기 전에 거부한다. Red: d190e3f5에서 uv-install owner test는 editable command를 기대했지만 sync만 관찰했다. Green: owner test 6개와 실제 uv editable source test가 통과한다(K657-3). 공통 link도 Python 설치를 uv에 위임하며 읽기 전용 legacy-link finding을 포함한 Python 통합 검사 3개가 통과한다.
- 실제 tool source fixture에 ecosystem manifest, case requirement id, generated-file 선언과 native PHP wrapper를 포함한다. Worktree tool은 공유 path API로 찾고, PHP extractor의 설치된 Composer autoloader를 사용하며, 과거 선언된 copy의 lint 검증을 명시적으로 유지하고 폐기된 Composer shadow manifest를 거부한다. Red: 65582113에서 소유 fixture가 실패한다. Green: 실제 tool 소유 case 15개가 통과한다(K661-3).
- Go module decoding은 array뿐 아니라 null Require와 Replace directive 집합도 허용합니다. PHP arginfo는 extension 개발에서만 준비하고 kit의 extension fixture는 명시적 설치 target으로 준비합니다. fixture discovery는 설치된 generator와 parser를 사용하며 parser 선택 test 입력은 platform에 의존하지 않습니다. Red: 2d18f681의 null Go 출력과 PHP library-only 설치 unit이 실패했습니다. Green: 소유 단위 test 58개와 typecheck가 통과합니다(K661-1).
- 문서 검사는 외부 checkout 없이 명시적 외부 Markdown 항목 참조를 구분하고, bare 및 kit 항목 참조 검증을 유지한다. Release coverage는 PHP lint project를 분류하고, release workflow는 archive 사전 검사와 bootstrap 순서를 유지하며, source와 packed export를 별도로 검사하고 package build assertion은 두 PHP arginfo parser project를 가리킨다. 선택한 문서 및 workflow test와 release coverage가 통과하며 package build는 최종 suite에서 실행한다(K661-2).
- Composer source link는 앱의 명시적 path repository와 선택한 개발 manifest를 사용하며 실제 lock, 설치 metadata, autoload는 Composer가 관리합니다. 임시 manifest, version alias, runtime record 보정은 제거했습니다. 실제 Composer/PHP 통합과 source-link 소유 case가 통과했고 release lock 설치는 별도로 유지합니다(K657-2).
- Native npm audit fix는 기존 dependency 제약 안에서 transitive fast-uri 3.1.8을 3.1.9로, markdown-it 14.3.2를 14.3.3으로 갱신하며 manifest version은 바꾸지 않습니다. 실제 review는 다섯 lock을 모두 advisory 없이 검토하고 stale sprintf-js exception을 제거합니다. Native npm audit는 취약점 0개를 보고하며 dependency-policy-check와 policy-review advisory 일치 case가 통과합니다. 새 ruff release는 정보로 유지합니다(K660).
- Rust lock advisory review를 위해 tool 선언에 cargo-audit 0.22.2를 포함합니다. make toolchain-lock이 지원하는 네 platform의 native mise lock entry를 생성했으며 선언과 lock 단위 test 7개가 통과합니다. 도구는 다른 checkout에서 복사하지 않고 main checkout의 make install-tools로 설치합니다(K660).
- Dependency gate는 현재 lock review의 허용되지 않은 알려진 advisory와 stale, 불완전, 중복 review coverage를 거부합니다. Dependency review는 advisory, stale advisory exception, 불완전한 조회에서 실패하고 새 release만 있는 경우는 정보로 남깁니다. 허용한 advisory는 출력에 이유와 제거 조건을 유지합니다. Red: 2d18f681에서 dependency-advisory.test.mts exit 1. Green: advisory와 Cargo 단위 test 12개, typecheck, docs-check가 통과합니다(K660).
- 명시적인 setup과 teardown 작업은 node reporter와 exit watchdog에 구조화한 lifecycle event를 전달합니다. gap과 exit watch는 해당 작업 동안만 멈추고 끝나면 다시 적용하며, 개별 case timeout과 test 미실행 실패 및 process 누수 정리는 유지합니다. Red: 65582113에서 K662 setup과 gap 회귀 검사가 실패했습니다. Green: K662 setup/gap/failure 회귀 검사 3개와 typecheck, docs-check가 통과했습니다(K662).
- npm 로컬 source link는 project-local prefix의 npm link가 생성하고 link와 설치 metadata도 npm이 관리합니다. release manifest와 lock은 유지되며 반복 실행에서도 source 수정이 바로 보입니다. Red: 80e3c56e의 native link 호출 이전 npm-install.test.mts가 실패했습니다. Green: 실제 npm source 수정 검증을 포함한 npm과 공통 link 단위 test 71개가 모두 통과합니다(K657-1).
- 명시적 `FINAL_RUN=1`은 대기 중 checklist 항목이 있는 깨끗한 커밋 트리를 허용하고, 진행 중 항목과 변경된 트리는 거부하며 기존 CI report 경로를 유지합니다(K658).
- parity 요구 추적은 명시된 영어 checklist의 정확한 항목이 `[!]`이고 그 task가 해당 id를 명시할 때만 요구를 보류합니다. 진행 중인 누락은 R13 finding으로 남고, 잘못되거나 활성 상태인 참조 및 중복 참조는 거부합니다(K656).

### 2026-10-26 — 종결된 checklist가 명시적인 local final run을 허용한다 (K654)

- 기존 suite guard는 모든 checklist item이 종결되고 양언어 checklist를 읽을 수 있으며 서로 일치하면 FINAL_RUN=1을 허용한다. Waiting 또는 active item, 누락된 checklist와 잘못된 기록은 경로와 상태를 밝히며 실행을 거부한다. ci-targets는 기존 report를 유지하고 정식 final mode를 test runner에 전달하며 일반 local suite는 계속 거부한다.
- PHP arginfo 설치는 prefix build directory에 generator가 없으면 PHP API extension directory 아래에서 gen_stub.php를 찾는다. Red: K652 API-directory fixture는 prefix만 찾는 코드에서 실패한다. Green: 수정 후 통과한다(K652).
- `make land`는 candidate와 main gate가 모두 실패했다고 알리고 candidate gate의 stdout과 stderr를 출력하면서 K631의 계속 진행 정책을 유지합니다(K631-1).
- parity declaration은 feature coverage part에 포함된 root를 해석해 정확히 하나의 implementation에 연결하며, part 밖의 test는 계속 거부합니다(K650).
- parity는 구현 root 안의 추적된 native test 파일 하나를 external-oracle unit에 정확히 연결하며, 형제 test는 계속 구현 owner가 관리합니다(K651).
- kit에 commit하거나 land해도 dist를 빌드하지 않습니다. consumer는 kit의 소스를 실행하고(K613) dist는 release 때 npm의 prepack이 빌드하므로, linked-build.mts의 kit 빌드(K551, K609의 kit 부분)를 지웠습니다(K646).
- `make commits-check`는 commit Subject 안의 id가 마지막 id와 다를 때만 거부합니다. 같은 id를 두 번 쓴 것은 여전히 한 행을 가리키므로, id를 반복한 push된 commit을 다시 쓸 필요가 없습니다(K648).
- `make commits-check`는 삭제 test를 대체하는 `Replaced-By`를 계속 허용하고, 항목이 명시적으로 보류되며 도달 가능한 보관 commit에 삭제 파일 내용이 모두 같을 때만 `Archived-To: <sha>`를 허용합니다(K647).
- divergence-check는 function_exists 대상과 구현 루트의 PHP 함수 선언을 대조합니다. namespace와 무관하게 선언된 함수는 공존 finding으로 남고, pg_connect와 pcntl_signal_dispatch 같은 미선언 런타임 기능은 허용합니다(K644).
- divergence-check는 전역 또는 네임스페이스 함수 확인을 PHP 구현 루트의 선언과 대조하고, 구현에 선언되지 않은 외부 네임스페이스 기능을 ORM 구현으로 오인하지 않습니다(K645).
- link과 link-state-check는 옆의 checkout에서 editable로 설치된 Python package를 dist-info의 direct_url.json으로 link된 것으로 보고, 다른 폴더에서 editable로 설치된 것은 보고한다(K643).
- `make commits-check`는 한국어 twin의 source-sha256 stamp를 범위의 tip에서만 판단합니다. tip은 land가 병합하고 docs-check가 읽는 tree입니다. rebase가 stamp를 낡게 남긴 중간 commit은, 같은 branch의 뒤 commit이 다시 stamp하면 finding이 아닙니다(K642).
- pack-manifest.mts에 test가 생기고, 그것과 linked-build.mts가 config/rebuild.json에 분류를 가지므로 make owner-validate와 make rebuild-check가 통과한다(K641).
- `make duplication-check`는 `config/generated.json`이 생성 파일로 선언한 파일, 곧 그 `paths`와 `exceptions`를 읽지 않습니다. orm-gen 같은 생성기가 쓴 파일은 입력마다 같은 틀을 반복하므로, 같은 파일을 `config/duplication.json`에 다시 적을 필요가 없습니다(K640).
- kit의 PHP-Parser Composer 프로젝트는 각자 이름(polyspec/kit-php-arginfo-5.0.0, polyspec/kit-php-arginfo-5.6.1)을 가지므로, link의 형제 검색이 패키지마다 공급자 하나를 찾고 모든 consumer에서 make install-link가 다시 실행됩니다(K639).
- `parity-declarations-check --id`는 선택한 requirement를 인용하는 unit의 R2 missing binding을 유지합니다. 따라서 `--id`와 `--rule`을 함께 써도 finding이 사라지지 않습니다(K638).
- install-tools는 선언한 PHP의 gen_stub.php가 이름 붙인 PHP-Parser release를 release마다 둔 kit의 잠긴 Composer 프로젝트에서 놓습니다: PHP 8.4는 scripts/kit/php-arginfo/5.0.0, PHP 8.5는 5.6.1. 이제 PHP 8.5를 선언한 저장소가 설치됩니다(K637).
- parity feature unit은 한 feature의 여러 coverage part에 requirement를 명시적으로 scope합니다. 각 implementation에는 자체 test binding이 필요하고, 모든 owner는 이름으로 지칭되거나 이름이 나온 implementation과 test를 명시적으로 공유해야 합니다(K635).
- divergence-check는 Go GOOS/GOARCH 값을 fmt.Fprintf의 machine 필드에서만 소비할 때 진단 metadata로 취급합니다. 실제 platform 분기는 계속 finding입니다(K636).
- make land는 한국어 쌍의 source-sha256 줄만 충돌한 rebase를 스스로 풉니다. 한 줄을 남기고 make documents-stamp로 다시 찍은 뒤 rebase를 이어갑니다. 다른 줄의 충돌은 여전히 거부합니다(K634).
- PHP 확장 build는 checkout의 php-config를 configure에 넘깁니다. 그러지 않으면 configure가 PATH의 첫 php-config를 씁니다. 이제 PHP 8.5용으로 build한 module이 .php-version의 PHP 8.4에 load되지 못하는 일이 없습니다(K632).
- make land는 main에서도 실패하는 gate를 그 행이 고친다는 메모와 함께 통과시키고, main이 통과하는 gate만 거부합니다. branch와 main의 출력 줄 비교와, progress 줄·임시 폴더·jscpd 요약을 위한 특수 처리는 삭제했습니다(K631).
- linked sources의 test는 package.json을 readFixture로 읽으므로 make lint-ts가 unsafe assertion을 보고하지 않는다(K633).
- PHP 확장 테스트는 PATH의 첫 PHP 대신 .php-version의 PHP, 곧 kit 자신의 var/tools/bin wrapper로 build합니다. PATH의 PHP는 kit이 고정한 것과 다른 PHP-Parser를 요구할 수 있습니다. 이제 세션의 PATH에 따라 통과하거나 실패하지 않습니다(K630).
- 저장소는 옆의 kit checkout의 source를 실행한다. kit-bootstrap.mk는 KIT를 그 scripts/kit로, KIT_EXT를 mts로 두고, package.json의 exports와 Claude hook은 source를 가리키며, source의 변경은 build 없이 소비자에 닿는다. npm pack은 dist exports, bootstrap, hook을 묶인 package에 쓰고(prepack) 그 뒤 되돌린다(postpack)(K613).
- make worktree-prune을 삭제했습니다. make land가 process가 없는 merge된 branch의 worktree를 모두 지우고(K626), prune을 import하는 consumer도 더 없습니다(orm T238)(K612).
- release와 PHP 확장의 테스트가 다시 lint-ts를 통과합니다. 문자열에 쓸모없는 escape가 없고, fixture 설정은 any에서의 assertion 대신 type guard로 좁힙니다(K629).
- make land가 merge 뒤에 지우는 worktree는 자기 commit이 있고 그것이 모두 main에 있는 branch의 것입니다. 곧 시작할 행을 위해 main에서 만든 새 branch는 main이 포함하더라도 남깁니다(K628).
- PHP extension builder는 호출자가 지정한 절대 module 경로로 게시하고 선언된 source-copy 및 configure 인자를 받아 run별 빌드도 공유 스테이징 로직을 사용합니다 (K247-3).
- PHP extension 빌드는 선언된 추적 공유 C 소스를 임시 패키지에 스테이징하고 Composer archive는 태그된 트리의 같은 소스를 포함합니다 (K247-2).
- make commit은 body의 Red나 No-Red 줄을 어디에 있든 따로 한 줄로 둡니다. 이제 문장 바로 뒤의 진술이 그 문장에 합쳐져 거부되지 않습니다(K627).
- make land는 worktree에서 process가 실행 중이어도 branch를 merge합니다. land는 branch를 읽기 때문입니다. 그 worktree와 branch는 process 목록과 함께 남기고, 다음 land가 main이 포함한 branch의 깨끗한 worktree 중 process가 없는 것을 모두 지웁니다(K626).
- 행의 red는 기록하지 않고 적습니다. 행을 done으로 옮기는 commit은 body에 red를 `Red: <command> exit <n> at <sha>`로 이름 붙이거나, 테스트가 보일 수 없는 변경이면 `No-Red: <reason>`를 적고, commits-check는 둘 중 한 줄이 있는지만 봅니다. No-Red를 적은 fix는 테스트 파일이 필요 없습니다. 기록기는 삭제했습니다: var/plan/<ID>.json, make item-red, item-state의 gate 실행, 기록 없는 done의 거부, rebase가 무효화하던 테스트 파일 hash(K624).
- worktree-setup은 main checkout의 var/composer-artifacts, 곧 composer.json이 이름 붙인 artifact repository를 하나의 directory symlink로 link하므로 worktree에서 Composer가 실행됩니다. docs/operations/local-links는 symlink가 worktree에 할 수 없는 일을 적습니다(K622).
- `make worktree-link-state`는 worktree의 설치 link를 준비하고 product package를 rebuild하지 않은 채 `link-state-check`를 실행합니다. 일반 `worktree-setup`은 계속 먼저 rebuild합니다(K619).
- catch-check-rust는 좁은 Err arm을 더 보고하지 않습니다. `Err(error) if error.kind() == NotFound => {}`처럼 guard가 있거나 안쪽 pattern이 error variant를 이름 붙인 arm은 이름 붙인 오류 하나만 다루고 나머지는 뒤의 arm에 넘깁니다. 모든 오류를 받는 빈 arm, 곧 `Err(_)`나 binding은 여전히 finding입니다(K620).
- kit-check는 PRINCIPLES.md, 그 짝, .editorconfig, .claude/settings.json이 ../kit의 같은 파일로 가는 추적된 link를 받아들이며, 이는 저장소가 link를 만들지 않는다는 규칙의 두 번째 예외이고, 그 밖의 추적된 link는 여전히 보고한다(K621).
- kit-check는 K614 이후 저장소에 그 복사본이 없으므로 kit-bootstrap.mk의 고정 task를 실행하는 kit에서 읽는다(K617).
- PHP library가 없는 저장소(fsm의 test bed처럼 packages/php가 application인 저장소)의 확장은 자기 composer.json의 polyspec/<repository>-php-ext로 이름을 얻고 library 선언과 비교하지 않습니다. 이름, stub, arginfo header는 전처럼 검사하므로 lint-php-ext가 더 거부하지 않습니다(K616).
- worktree-setup은 link가 main checkout의 각 go.mod 옆에 쓴 git-ignored go.work와 go.work.sum을 worktree에 줍니다. 이제 worktree의 Go build는 module cache의 형제 module release 대신 형제 checkout을 읽습니다(K615).
- kit은 alint가 저장소 안에서 읽어야 하는 config/layout.kit.yml과 그것이 이름 붙인 schema 세 개만 복사한다. 저장소는 ../kit의 kit-bootstrap.mk를 include하고, PHP lint는 kit에서 읽으며, PRINCIPLES.md, 그 짝, .editorconfig, .claude/settings.json은 ../kit로 가는 link가 된다(K614).
- check-rules 테스트는 P10과 P38이 지금 말하는 구절을 이름 붙이고(규칙에 더 없는 구절을 이름 붙였습니다), worktree-setup 도움말은 K596에서 없앤 디스크 하한을 더 말하지 않습니다(K611).
- 동시에 실행하는 PHP extension library test는 각 Composer fixture를 따로 준비하고 PHPUnit 종료 뒤 정리해, 서로의 vendor symlink나 autoloader를 바꾸지 않습니다 (K610).
- land는 병합 뒤 main commit처럼 link된 consumer가 읽는 것을 갱신한다. kit에서는 build 입력이 dist를 build하고, 다른 곳에서는 낡은 link된 package를 다시 build한다. make commit과 land는 linked-build.mts를 함께 쓴다 (K609).
- 기록된 red 없이 done을 거부하는 메시지는 K608이 지운 item-red BEFORE=를 더는 권하지 않는다 (K608-1).
- item-red은 행의 tree에서 Verification을 돌리고 BEFORE=를 받지 않는다. 옛 commit으로 바꿔 끼우는 일, 그 build, 그 검사(K389-1, K389-3, K525, K553, K556)는 지웠고, 옛 수정의 red는 git으로 직접 기록한다 (K608).
- commit의 Red-Gate와 Red-Test 줄은 item-red가 Verification을 돌린 head를 적고, red의 증명은 그 기록이다. Verification이 통과할 수도 있는 merge-base와 조상 검사는 없앴다 (K562).
- kit은 자기 lint-ts, layout-check, owner-validate, rebuild-check를 통과한다. 쓰지 않는 import를 지우고, catch-check-rust는 S9 예외, workspace lint, owner를 갖고, 모든 도구는 분류를 갖는다 (K606).
- dependency-policy-check은 command line의 PACKAGES일 때만 --packages를 넘겨, 자기 PACKAGES를 정의한 repository도 모든 package에 gate를 돌린다 (K605).
- `make land`는 선택된 static gate를 한 번 실행한 뒤 merge 전후 build 없이 fast-forward하고 branch와 worktree를 안전하게 정리한다(K603).
- Parity declaration은 tool 소유 requirement를 정확한 native test로 추적하면서도 tool을 공통 runtime implementation으로 등록하지 않습니다(K604).
- dependency-policy-check은 Composer lock을 manifest와 대조하지 않고, composer.json이 Composer platform에 포함되는지도 보지 않는다(K180, K181). polyspec 패키지의 설치는 link이므로 lock은 개발 manifest가 떠난 release를 기록한다 (K602).
- land는 duplication-check의 결과로 clone 블록만 세서, detection time처럼 실행을 설명하는 jscpd 줄이 land를 거부하지 않는다 (K599).
- land는 jscpd 보고서를 끝맺는 시간 줄을 duplication-check의 finding으로 세지 않아, 같은 clone 집합이 새것으로 거부되지 않는다 (K600).
- worktree-setup은 다른 checkout의 provided package를 main checkout이 가진 것처럼 그 checkout 폴더로의 symlink 하나로 link하고, main checkout 항목으로의 이전 link를 대체한다 (K598).
- worktree-setup은 자유 디스크 때문에 worktree를 거부하지 않고 Go build cache를 정리하지 않는다. 사용자의 결정에 따라 30 GB floor와 K538, K538-1의 정리를 제거했다 (K596).
- Composer package는 vendor의 폴더가 symbolic link일 때 link된 것이므로 dependency review가 그것을 registry와 비교하지 않는다. link가 더는 쓰지 않는 composer.link.json과 composer.link.lock의 code를 지운다(K595).
- link-state-check는 각 설치 위치가 올바른 symbolic link인지와 tracked lock의 release 기록, go.work, Claude Code hook만 판정한다. mise trust, merge된 branch, provider의 build는 그 finding이 아니다(K594).
- kit.mk은 컴파일러를 감싸지 않고 cargo jobs를 정하지 않는다. 아무 repository도 쓰지 않던 K581의 sccache wrapper는 제거했다 (K593).
- uv-install은 package link를 유지한다. uv sync는 폴더가 symlink인 각 package에 --inexact와 --no-install-package를 넘겨 uv가 link를 통해 쓰지 않게 하고, K539, K545, K554의 uv 전 link 해제와 held package는 제거했다 (K592).
- 설치된 각 polyspec package는 checkout의 package 폴더로 가는 directory symlink 하나다. 이것이 사용자의 규칙이다. Python(K541)과 npm(K558)의 per-file tree, K574의 의존성 link, K578과 K579의 선언된 file: link는 제거했다 (K591).
- link는 자기 lock이 없는 workspace member(npm workspace member 또는 root path repository의 Composer package)의 설치된 폴더를 member 자신에게 요구하지 않고 그것을 설치하는 lock의 project에서 가져온다(K590).
- link는 다른 repository의 link된 npm package가 선언했지만 consumer가 resolve하지 못하는 runtime 의존성과 그 의존성을 provider checkout이 설치한 폴더에 link하고, link-state-check는 빠진 것을 이름 붙인다. lock은 다시 쓰지 않는다 (K574).
- 배포 소스가 import하는 모듈의 type package인 @types/picomatch와 @types/semver는 패키지의 dependency다. 그래서 per-file link로 그 소스를 type-check하는 consumer가 그것을 찾는다 (K582).
- gate가 도는 동안 main이 움직인 land는 움직인 commit의 path가 고르는 gate, commits-check, build만 다시 돌린다. 입력을 건드린 commit이 없는 gate는 결과를 유지하므로 병렬 land가 더는 main을 쫓지 않는다 (K580).
- main의 commit이 build된 출력을 가진 npm package의 build 입력을 바꾸고 그 출력이 stale이면 저장소를 다시 build하므로, main checkout을 live로 link한 checkout이 그 build를 fresh로 본다(K583).
- consumer가 tarball로의 file: 의존성으로 선언한 npm package는 npm이 진짜 폴더로 풀므로 tarball로의 link가 아니라 provider로의 per-file link tree가 된다. 폴더로의 의존성만 K578의 link로 남는다 (K579).
- mise.toml이 sccache를 선언한 checkout은 모든 worktree가 공유하는 main checkout의 var/tools 아래 cache 하나(5G 제한)로 Rust를 컴파일하고, cargo는 호출자가 CARGO_BUILD_JOBS를 정하지 않으면 core의 절반을 쓴다 (K581).
- 디스크가 floor 아래이면 worktree-setup은 Go build cache를 오래된 것부터 floor를 채울 때까지 정리하되 최근 10분의 파일은 남긴다. 병렬 build가 cache 전체를 두 시간보다 젊게 유지하기 때문이다 (K538-1).
- merge 뒤 main의 build와, land가 비교하는 main의 gate 실행은 land lock이 풀린 뒤 자기 main build lock 아래에서 돈다. 그래서 다음 land는 main이 build하는 동안 merge한다 (K572).
- 패키지는 providedFolders, linkFolders, folderFindings를 담은 ./link-folders를 export한다. 그래서 consumer의 테스트는 K558의 per-file link tree를 kit의 코드로 만든다 (K576).
- consumer가 직접 file: 또는 link: 의존성으로 선언한 npm package는 per-file link tree가 아니라 npm이 쓰는 선언 경로로의 link 하나로 남고, link는 그런 tree를 다시 그 link로 바꾼다 (K578).
- make item-red는 test가 하나도 돌지 않은 실패 요약을 그 요약이 실패한 build나 load를 가리킬 때만 판정하므로, test를 돌리지 않는 step 뒤의 check finding은 red이고, compile이나 load 실패는 여전히 자기 오류 줄로 거부된다(K540-2).
- link는 다른 저장소의 npm 패키지 폴더를 provider의 node_modules 없는 파일별 link의 폴더로 만들어, --preserve-symlinks로 실행한 node가 패키지의 의존성을 consumer의 node_modules에서 resolve한다(K558).
- land lock은 main이 아직 gate가 돈 commit인지 확인하는 단계와 fast-forward만 덮는다. 서로 무관한 land의 gate와 build가 겹치고, main의 commit은 merge만 기다리며, gate 중 main이 움직인 land는 rebase하고 gate를 다시 돌린다(최대 세 번) (K571).
- 어떤 실패든 없음이나 부재로 읽던 kit의 binding 없는 catch(dependency policy, 문서 검사, divergence 검사, 폴더 링크, parity 선언, 테스트 선택)는 자기 결과를 뜻하는 class나 errno로 좁히고 나머지를 다시 던진다 (K559).
- land는 ESRCH만 더는 실행되지 않는 land로 읽고, 문서 검사는 kit checkout의 checklist를 읽을 수 없으면 note 대신 실패한다 (K559).
- catch-check은 잡은 것을 살필 수 없는, binding 없는 catch 절을 거부한다. 앞 줄이 `// catch-any -- <이유>`로 이유를 밝히면 통과한다 (K561).
- 어떤 실패든 없음, 부재, 실행 안 함 또는 note로 읽던 kit의 catch는 자기 결과를 뜻하는 class나 errno로 좁히고 나머지를 다시 던진다 (K559).
- divergence-check는 multiline PHP assertion을 하나의 assertion으로 평가하고, branch에서 쓰인 environment probe는 계속 보고한다(K543-1).
- land는 scan total이 달라질 때 duplication finding 비교에서 ANSI 색상 jscpd aggregate Total summary 행을 제외하고 clone finding은 유지한다(K570).
- PHP extension stub parser는 internal class를 찾을 때 comment 안의 namespace 텍스트를 무시한다(K569-1).
- PHP extension declaration check는 stub에 명시된 internal class를 반영하고 PHP `self` type을 선언 class와 비교하며, 선언되지 않은 public class는 계속 거부한다(K569).
- land는 duplication-check finding을 비교할 때 ANSI 색상이 적용된 jscpd 언어별 요약 행을 인식하며 clone 세부 내용은 finding으로 유지한다(K394-5).
- land는 duplication-check 결과 비교에서 형식이 확인된 jscpd 언어별 통계 행만 제외하고, 새 clone 블록은 계속 통합을 거부한다(K394-4).
- Claude hook은 Node wrapper가 `--` 뒤에 전달하는 runner command를 따라가므로 Make target을 통한 exact Cargo native case를 인식한다. `--exact` 실행에는 선택된 test name이 필요하며 selection 없는 실행과 workspace 실행은 local에서 계속 거부한다(K568).
- Parity R12는 feature binding을 implementation과 native case id로 구분하여 한 implementation이 같은 test file의 database case를 각각 binding할 수 있다. 같은 case id 반복과 suite/API 중복 항목은 계속 거부하며, feature run은 선언된 모든 id를 각각 두 번 실행한다(K567).
- Parity owner scope는 선언된 coverage part와 release artifact에서 적용 범위를 도출해 공유 requirement를 모든 client에 보존한다. Cargo feature binding은 exact native test id만 실행한다(K566).
- gates workflow는 consumer를 설치하기 전에 fresh sibling Kit을 build하므로 consumer bootstrap이 Kit의 dist를 읽는다(K565).
- dependency-policy-check는 root override의 정확한 package 이름과 URL이 root 또는 workspace의 직접 dependency와 일치할 때 remote package tarball을 허용한다. 다른 이름, URL과 transitive-only override는 계속 실패한다(K564).
- recipe-tools는 shell command를 찾을 때 POSIX parameter expansion을 보존하므로, 유효한 usage expression이 toolchain-check를 중단하지 않는다. K563은 수정 전 실패하고 수정 후 통과한다(K563).
- PHP extension build는 설치된 parser로 arginfo를 offline 생성하고, Composer archive는 tag stub에서 generated header를 만들어 고정된 ZIP metadata와 함께 넣는다(K560).
- commit gate는 checkout에 설치된 각 nested npm project의 staged lock을 offline 설치해 gate가 해당 staged project의 dependency를 읽게 한다(K404-1-2).
- make item-red는 실패한 Verification을 실패의 원인으로 판정한다. test runner의 실패한 run만 그 test로 판정하므로, 통과한 test 뒤에 finding을 낸 check는 red이고, timeout이나 test 전에 실패한 build, compile, load는 여전히 red가 아니다(K540-1).
- docs/operations/release-structure.md는 kit의 릴리스 구조를 검토한다. 안정된 bootstrap 층, 참조로 쓰는 설정, 도구가 요구하는 곳에만 사본, 의존 순서로 묶은 릴리스다(K194).
- worktree의 vendor/composer는 main checkout의 것의 모든 파일을 가지며, 설치 기록과 InstalledVersions.php는 worktree의 파일이므로 PHP가 worktree의 설치 경로를 읽는다(K557).
- make item-red BEFORE=는 tree의 파일을 바꾸므로 main에서는 거부되고 행의 worktree에서 실행된다(K556).
- worktree-setup은 main checkout의 모든 Python 환경을 var/python처럼 저장소가 두는 곳 그대로 worktree에 주고, 그 editable install은 worktree의 source를 이름 붙인다(K555).
- 디스크 하한 아래에서 worktree-setup은 두 시간 쓰이지 않은 Go 빌드 캐시 항목을 지우고, 비운 바이트를 보고하며, 디스크가 여전히 하한 아래일 때만 거부한다(K538).
- build 입력을 바꾸는 kit 패키지 main의 commit은 make kit-build를 실행하므로, consumer가 live로 link하는 dist가 source를 따른다(K551).
- make item-red BEFORE=는 Verification이 kit-gates의 gate만 실행하면 바뀐 테스트 파일도 바꾸므로, 테스트 파일의 lint fix가 red를 증명한다(K553).
- uv-install은 환경이 가진 모든 제공 패키지를 폴더가 없어도 checkout에서 link하고 아무것도 다시 설치하지 않으므로, 네트워크와 cache를 읽지 않는다(K554).
- run-tests는 go와 cargo의 test를 실행하기 전에 20분의 build bound 아래에서 build하므로, compile이 더는 test 없는 gap으로 세어지지 않는다. 실패하거나 bound를 넘는 build는 그 출력과 자기 메시지로 run을 멈춘다(K549-1).
- uv-install은 가진 패키지를 별도 실행에서 uv cache로 오프라인 재설치하고, cache에 없는 wheel을 이름 붙이며, 자기가 설치하는 프로젝트는 뺀다(K548).
- worktree-setup은 vendor의 Composer bin proxy를 worktree에 쓰므로, worktree의 모든 vendor 바이너리가 worktree를 autoload한다(K550).
- divergence-check는 분기 없이 자기 환경을 assert하는 테스트 문장을 통과시키고, 분기 안의 probe는 여전히 잡는다(K543).
- run-tests의 gap watch는 test process의 시작을 120초의 start-up bound로, process가 up을 알린 뒤의 gap을 test timeout으로 묶으므로, 부하가 걸린 machine에서 interpreter의 시작이 더는 통과하는 run을 실패시키지 않는다. up을 알리지 않는 process는 자기 메시지와 함께 start-up bound에서 멈춘다(K549).
- test-exit-deadline preload가 각 test 앞뒤에서 기다리는 event loop 한 바퀴는 process 시작 때의 setTimeout을 쓰므로, timer를 mock하는 test가 더는 hook을 멈추지 않는다(K547).
- uv-install은 환경이 가진 제공 패키지를 dist-info 기록으로 읽고, 폴더가 없어도 그 각각을 다시 설치한다(K545).
- node test의 event는 test가 event loop를 막을 때도 test가 끝날 때 run-tests에 도착한다. test-exit-deadline preload가 각 test의 앞뒤에서 loop를 한 번 돌리므로, 합쳐서 deadline보다 오래 걸리는 동기 test 파일이 통과하는 중에 멈추지 않고, tests/kit/lint-ts.test.mts가 더는 30초에 실패하지 않는다(K546).
- uv-install은 uv sync 전에 link를 해제한 각 제공 패키지를 다시 설치하고, 폴더 없이 끝난 패키지는 조용히 통과하지 않고 이름 붙여 실패한다(K544).
- make item-red와 make item-state는 실행되어 실패한 test나 gate만 red로 기록한다. 찾지 못한 명령(exit 127), test가 시간을 넘기고 하나도 실패하지 않은 실행, test 전에 실패한 실행(build, compile, load 실패)은 이유와 함께 거부되고 아무것도 기록되지 않는다(K540).
- link는 제공된 각 Python 패키지 폴더를 provider로 가는 파일별 link의 진짜 폴더로 만들므로 어떤 uv 설치도 link를 통해 provider checkout에 쓰지 않고, uv 전의 link 해제는 중첩된 link에도 닿는다(K541).
- 문장 없는 catch는 lint를 통과하지 못한다. lint-ts는 catch-check(oxc-parser)를 돌려, oxlint no-empty가 주석이 있으면 통과시키는 문장 없는 catch 절과 .catch callback을 거부하고, lint-rust는 catch-check-rust(package의 syn crate, offline 빌드)를 돌려 clippy가 lint하지 않는 그런 Err(..) arm과 `if let Err(..)` branch를 거부한다. Python, PHP, Go는 ruff S110, phpcs EmptyStatement, staticcheck SA9003이 이미 다룬다(K537).
- owner-validate은 kit이 내보내는 owner 규칙의 glob을 consumer의 경로에 대해 확인하지 않는다. consumer는 commit하는 hook처럼 그 일부만 가지기 때문이다(K542).
- link와 uv-install은 각 uv 설치 전에 Python 환경의 패키지 link를 지우므로, uv가 link를 통해 provider checkout에 쓰지 않는다(K539).
- make item-red BEFORE=는 swap이 build 입력을 바꾸면 BEFORE에서 저장소를 build하고 복원 뒤 다시 build하므로, build를 import하는 테스트가 red를 증명한다(K525).
- main의 make commit과 main에서의 item-new 등록은 land의 lock을 가지므로, 그것들과 land는 서로의 변경을 보지 않고 줄을 선다(K524).
- lint-go는 deadcode를 모듈 build tag의 합집합으로 판정하므로, 한 tag의 파일이 도달하는 함수는 다른 실행의 finding이 아니다(K536).
- link-state-check은 linked worktree에서 main checkout의 mise trust를 받아들이고, worktree에 commit되지 않은 변경이 있는 branch를 사용 중으로 보며, linked worktree에서는 자기 branch만 판정한다(K532).
- kit-check은 owner 규칙이 lint가 kit-gates의 gate인 언어의 각 source 경로에 그 lint와 duplication-check를 선택하는지 확인하므로, land가 들이는 것을 lint한다(K534).
- worktree-setup은 main checkout이 설치한 모든 npm 프로젝트와 Python 환경을 worktree에 주되, main checkout의 것으로 link하고 저장소 자기 source는 worktree에서 쓴다(K533).
- makeVenv가 checkout에 없는 uv나 Python과 그것을 설치하는 방법을 다시 알린다. 도구를 찾기 전에 uv, 그다음 python3를 검사하므로 K393-1의 검사가 그 메시지를 가리지 않는다(K535).
- land는 실행하는 각 make의 출력이 닫히기가 아니라 종료를 기다리고, 30분 기한을 넘긴 실행은 target을 이름 붙여 멈춘다(K531).
- link는 --project 폴더의 uv workspace member를 읽고, Composer처럼 config.vendor-dir보다 COMPOSER_VENDOR_DIR을 먼저 읽으며, member의 hatchling sources를 설치된 package 경로로 대응시키고, 설치 폴더가 없는 선언된 polyspec package를 link와 check에서 이름과 함께 실패시킨다(K529).
- worktree-setup은 worktree에 main checkout의 패키지로 link한 node_modules를 주되 저장소 자기 workspace 패키지는 worktree 안으로 link하므로, worktree가 자기 TypeScript를 시험한다(K530).
- claude-hook은 sh, bash, zsh, dash -c의 script를 모든 규칙으로 읽으므로, 그 안에서 sleep하는 loop도 밖에서처럼 거부된다(K528).
- suppression-check는 Rust allow나 expect를 닫는 )]까지 읽으므로, rustfmt가 여러 줄로 쓴 attribute의 reason이 인정된다(K527).
- make npm-install은 install-packages처럼 allow-remote=root로 npm ci를 실행하므로, kit release를 지정한 consumer lock이 설치된다(K526).
- commit과 land의 gate는 owner-validate처럼 kit이 내보내는 owner 규칙을 읽고, kit.owners는 make hooks가 쓰는 모든 hook을 소유하므로 consumer가 hook을 commit할 수 있다(K522).
- make worktree-setup은 worktree의 각 Composer 프로젝트에 main checkout의 패키지로 link한 vendor 폴더와 자기 autoload를 주므로, 저장소 자신의 class가 worktree에서 로드된다(K521).
- docs/spec이 두 번 정의한 요구사항은 범위 실행을 포함한 모든 parity 선언 검사를 실패시키고, finding은 두 정의의 파일과 줄을 이름 붙인다(K520).
- uv-install, link, link-state-check는 checkout이 가리키는 uv workspace root의 member를 Python provider에 포함하므로, 설치된 member가 link된다(K518).
- unit으로 범위를 정한 parity 검사는 schema를 어기는 unit을 빼고 이름을 밝힌 뒤 나머지에 규칙을 실행하므로, 범위 실행이 실행 없이 통과하지 않는다(K517).
- 링크된 worktree는 main checkout의 도구를 쓰고 아무것도 설치하지 않는다. mise의 data dir, install, shim과 var/tools/bin은 main checkout의 것이고 mise.toml만 worktree 자신의 것이므로 worktree에서 make land가 pypi:vulture를 찾는다. worktree에서 install-tools와 install-kit은 거부되고, worktree-setup은 make install 대신 node_modules를 link한다(K519).
- kit이 내보내는 owner 규칙은 kit이 더는 복사하지 않는 lint 설정을 소유하지 않으므로, kit-sync 뒤의 consumer가 owner-validate를 통과한다(K514-2).
- make land는 어디서 호출되든 main을 checkout한 checkout으로 land하고, main을 checkout한 checkout이 없으면 그것을 이름 붙여 실패한다(K516).
- polyspec-lock-check와 config/polyspec.json을 제거했다. 추적되는 lock은 각 polyspec 패키지의 release를 기록하고, gate는 추적되는 lock의 release URL이 이름 붙인 sibling 저장소를 clone한다(K515).
- kit-check는 kit이 더는 복사하지 않는데 저장소가 아직 가진 lint 설정을 make kit-sync를 고침으로 하여 이름 붙인다(K514-1).
- main에서 make item-new는 BODY_FILE로 행 등록을 docs(plan) commit 하나로 commit하며, BODY_FILE이 없거나 다른 변경이 staged면 무엇을 쓰기 전에 거부한다(K499-2).
- 각 lint는 설정을 kit 패키지에서 읽는다(ruff.toml, phpcs.xml.dist, phpstan.dist.neon, .golangci.yml, clippy.toml, .oxlintrc.json, knip.json). kit-sync는 이 사본들과 config/api-extractor.kit.json을 저장소에서 지운다(K514).
- land는 main이 움직이기 전에 worktree의 merge 결과로 make build를 실행하고, build가 실패하는 branch는 아무것도 merge하지 않고 거부한다(K513).
- link는 .git에 아무것도 쓰지 않는다. consumer의 .gitignore가 /.claude/settings.local.json을 무시하며, Git이 무시하지 않는 동안 link-state-check가 그 파일을 이름 붙이므로 sandbox 안의 worktree도 link된다(K512).
- Python 폴더 link는 uv가 sync하는 환경, 즉 UV_PROJECT_ENVIRONMENT가 설정되면 그것(limepie의 python/var/venv)을, 아니면 .venv를 읽으므로 그 polyspec 패키지가 link된다(K448-14).
- bootstrap의 install-packages는 다시 package-lock.json을 npm ci로 설치하므로, CI runner처럼 kit.mk가 없는 checkout도 @polyspec/kit을 설치한다. make install은 그 뒤 link한다(K511).
- link 계약(docs/operations/local-links.md)은 폴더 link를 적는다. polyspec 패키지는 release로 설치된 것으로 보고, 설치 뒤 폴더를 직접 상대 symlink로 바꾸며, 복사본은 금지이고, 어떤 단계도 버전을 판단하지 않으며, worktree는 도구와 의존 폴더를 main checkout의 것으로 link한다(K448-4).
- `make link`은 checkout의 모든 tracked 프로젝트의 설치된 polyspec 패키지를 link하며, hyper의 examples/board 같은 중첩 Composer 프로젝트도 포함한다. 테스트, fixture, release consumer는 시험하는 설치를 그대로 둔다(K447).
- push gate는 push되는 각 commit의 메시지와 identity, push되는 tip의 checklist를 한 번 검사하고 checklist 텍스트의 Markdown을 한 번만 파싱하므로, 수백 개 commit의 백업 push가 모든 commit 검사를 다시 실행해 멈춘 것처럼 보이지 않는다. 각 commit의 item, 행, twin 규칙은 commit-msg hook과 land의 commits-check에 남는다(K510).
- land와 branch commit의 행 ID 검사는 branch가 갈라진 뒤 더하거나 바꾼 행만 main과 비교하므로, 행 문구를 바꾼 main보다 뒤처진 branch가 더는 거부되지 않는다(K497-1).
- `link --project <dir> --siblings`와 `check --project <dir> --siblings`는 옆에 polyspec checkout이 없는 consumer의 claude-hook 항목을 early return 전에 쓰고 검사한다(K498-4).
- main의 `make commit`은 checklist의 크기와 상관없이 HEAD의 행을 읽으므로 orm의 checklist(1MB 초과)의 상태 변경은 새 행이 아니며, git이 읽지 못하는 HEAD의 checklist는 원인과 함께 commit을 실패시킨다(K499-1).
- K452-1를 닫는다 (K452-1): 확장 검사가 커밋되었고 커밋된 트리에서 검증되었다.
- K452-1를 마친다 (K452-1): 실행 시작 전에 각 PHP 확장을 검사하고, 로드되지 않는 것은 경로와 실행 중인 PHP를 이름으로 대며 실패한다.
- 확장 실행은 PHPUnit을 시작하기 전에 각 --php-extension을 검사한다: 로드되지 않는 것은 .so 경로, PHP가 보고하는 내용(빌드된 API), 실행 중인 PHP를 이름으로 대므로, 라이브러리를 잘못된 PHP에서 조용히 테스트하지 않는다 (K452-1).
- K452를 마친다 (K452): run-tests의 확장 실행이 패키지 phpunit.xml을 --configuration으로 넘겨, 라이브러리 실행과 같이 bootstrap이 로드된다.

### 2026-10-22 — 확장 실행이 PHPUnit에 패키지 설정을 준다 (K452)

- link는 폴더다(K448): `make link`, `npm-install`, `composer-install`, `uv-install`은 tracked lock을 그대로 설치한 뒤, checkout이 제공하는 설치 패키지 폴더(node_modules, vendor, site-packages)를 그 checkout으로 가는 직접 상대 symlink로 바꾸고 복사본을 지운다. link에는 composer.link.json, file: spec, editable wheel, package manager의 해석이 남지 않으며, 그 폴더 밖에는 아무것도 쓰지 않는다. kit은 버전도 pin도 강제하지 않는다(S4): link-state-check는 복사본이나 잘못된 link만 판단하고(그리고 이제 release tarball과 저장소 자신의 패키지를 받아들이는 K507의 release 기록), dependency-policy-check는 sharedPin, local, tagged, latest, stale, PHP platform pin, 제약 검사, 검토 기록, advisory를 뺀다. toolchain-check는 release를 비교하지 않고, dependency-review는 실패하지 않고 보고한다. 업데이트 후 `make link`를 한 번 실행하라.
- `make land`와 branch의 `make commit`은 main이 다른 task로 가진 ID의 checklist 행을, 그 ID가 branch 자신의 행이 아니면 거부하고, main과 어떤 로컬 branch도 갖지 않은 다음 ID를 이름 붙인다(K497).
- `scripts/kit/run-tests.mts`가 확장 실행에 패키지의 `phpunit.xml`(또는 `phpunit.xml.dist`)을 `--configuration`으로 넘긴다(K452). 그래서 설정이 지정한 bootstrap이 라이브러리 실행과 같이 로드되고, bootstrap 함수를 부르는 orm 같은 테스트가 확장에서 더는 실패하지 않는다. Red: `node --test --test-name-pattern=K452 tests/kit/run-tests.test.mts`가 6d3db7685abd에서 수정 전 실패; green: 통과, 이 파일의 62개 테스트 모두 통과.
- `link --project`가 `<dir>/.claude/settings.local.json`에 쓰는 Claude Code hook 항목은 kit checkout의 node를 이름으로 든다. 그래서 link와 check를 어느 node로 실행하든 서로 일치하며, check는 kit node가 없으면 보고한다(K498-3).
- main에서 `make commit`은 index가 그곳에 stage한 새 item의 checklist row를 거부하고, 그 등록의 branch 경로를 이름으로 든다. 변경이 stage된 main checkout의 land는 이미 거부된다(K499).
- K509: `make polyspec-lock-check`는 추적 매니페스트의 프로젝트 폴더에 대해 config/polyspec.json이 선언한 polyspec 이름을 면제하므로, kit 패키지를 선언한 소비자가 검사를 통과한다 (K509). Red: 수정 전 `node --test --test-name-pattern=K509 tests/kit/polyspec-lock.test.mts`가 1096cb67에서 실패했고(선언된 @polyspec/kit이 finding이었다), green은 파일 10/10 통과한다.
- `make land`는 main이 앞지른 branch를 lock 아래에서 그 깨끗한 worktree에서 main 위로 rebase하고 rebase된 commit에 gate를 실행하므로, 다른 land를 기다린 land는 rebase를 요구하지 않고 land된다. 충돌하는 rebase는 abort하고 파일을 이름 붙여 거부한다(K495-1).
- `make composer-install DIR=<project> CHECKOUTS="<checkout>..."`은 Composer 프로젝트의 polyspec 패키지를 제공하는 checkout을 DIR 뒤에서 받으므로, 설치가 저장소를 명시하고 sibling 탐색이 필요 없다. `NO_DEV=1`은 그것과 함께 계속 동작한다(K501). Red: aff8cbac에서 `node --test --test-name-pattern=K501 tests/kit/link.test.mts`가 실패했다. CLI가 checkout 인수를 usage 메시지와 함께 거부했다.
- K507: `make link-state-check`는 polyspec 패키지를 path 또는 link source로 기록한 추적 Cargo.lock, package-lock.json, composer.lock을 거부하며, 파일, 패키지, release source 형식을 이름 붙인다(source 없는 Cargo 패키지, link 또는 file: resolved, Composer path dist). 그래서 추적 lock은 release 기록으로 남는다 (K507). Red: 수정 전 `node --test --test-name-pattern=K507 tests/kit/link-state-check.test.mts`가 f68fe82e에서 실패했고(path lock 3개가 통과), green은 파일 25/25 통과한다.

### 2026-10-22 — 체크아웃의 Composer 셔임은 kit의 도구 환경으로 실행된다 (K508)

- land의 K459 테스트는 K453 이후 land가 merge 뒤 실행하는 build target을 fixture에 주므로 main에서 다시 green이다(K504).
- K508는 닫힌다: red와 green은 위에 기록되어 있다 (K508).
- `tests/kit/dependency-review.test.mts`가 체크아웃의 Composer 셔임을 kit의 도구 환경(`toolingEnvironment`)으로 실행한다. 그 환경이 셔임에 체크아웃의 신뢰와 디렉터리를 준다 (K508). 없으면 셔임이 "mise.toml are not trusted"로 실패한다. Red: `node --test --test-name-pattern=K508 tests/kit/dependency-review.test.mts`가 51969e466b9f에서 수정 전 실패; green: 통과.
- K490: review record는 tracked composer.json이 선언한 의존성을 적는다; link manifest는 아무것도 더하지 않는다 (K490). Red: make item-red ID=K490 exit 1 (vendor/linked가 기록됨). Green: make 아래 make item-test ID=K490 통과, lint-ts 통과. (K490).
- `link --project <dir>`는 package를 link하기 전에, 그 결과와 관계없이 `<dir>/.claude/settings.local.json`의 kit hook 항목을 쓰므로, 설치되지 않은 checkout도 hook을 받는다(K506).
- K492: kit의 Go 핀은 advisory GO-2026-6809가 없는 릴리스 go1.27.3이다; mise.toml, lock, 핀 파일, symbols go.mod, tool inventory가 그것을 적는다. Red: make item-red ID=K492 exit 1 (kit 핀 1.27.2). Green: make 아래 make item-test ID=K492 통과. (K492).
- `make land`는 실행 내내 lock을 잡으므로 두 번째 land는 첫 번째를 기다리고, gate가 도는 동안 main이 움직였으면 움직인 commit을 이름 붙여 merge를 거부한다. `make hooks`는 reference-transaction hook을 쓰며, 그 hook은 make land(`KIT_MAIN_WRITER`)나 pre-commit hook을 통과한 commit이 아닌 main의 이동을 거부하므로 main에서 수동 `git merge --ff-only`, `git reset`, `git commit --no-verify`는 거부된다. `make hooks`를 한 번 실행하라(K495).
- K448-5-2: `make cargo-fetch`는 patch된 그래프를 link 상태(var/link)에서 --locked 없이 해석하고 fetch하므로, dependency가 잠긴 release보다 앞선 sibling이 fetch를 실패시키지 않는다. 추적 Cargo.lock과 Cargo.toml은 그대로이며, sibling 없이 실행하면 plain 잠금 fetch를 유지한다 (K448-5-2). Red: 수정 전 `node --test --test-name-pattern=K448-5-2 tests/kit/link.test.mts`가 9f3a0ff8에서 실패했고(fetch가 --locked로 실행됨), green은 K448, K489, K440 테스트가 15/15 통과한다.
- K478: 추적된 polyspec-lock 검사는 link의 repository 범위 package ownership을 써서 자기 workspace의 package는 허용하고 외부 sibling finding은 유지한다 (K478). red: 8f487225에서 `node --test-name-pattern=K478` exit 1(자기 workspace 테스트 두 개), green: K478 테스트 통과.
- K478-1: checkout 밖으로 해석되는 추적된 package manifest symlink는 locked 외부 0.0.x polyspec package에 ownership을 주지 않는다 (K478-1). red: checkout 밖 guard를 뺀 상태의 K478-1 테스트 exit 1, green: K478-1 테스트 통과.
- `link --project <dir>`는 실행한 kit의 claude-hook의 Bash PreToolUse hook을 추적되지 않는 `<dir>/.claude/settings.local.json`에 쓰고, 파일의 다른 key를 유지하며, `<dir>`의 Git exclude로 그 파일을 무시하게 한다. `link check --project <dir>`는 hook이 없으면 그 파일을 이름으로 든다 (K498).
- `make npm-install`은 project의 `.npmrc`를 임시 설치 폴더로 복사하므로, npm이 project의 설정(예: checkout이 제공하는 platform peer를 위한 `legacy-peer-deps=true`)으로 설치한다(K502). Red: `node --test --test-name-pattern=K502 tests/kit/npm-install.test.mts`가 71ef287d에서 실패했다: 설치의 npm이 `.npmrc`를 찾지 못했다.
- PHP 애플리케이션 예시는 framework 제품 이름을 적지 않는다: PRINCIPLES.md의 S10과 한국어 짝, common-standard checklist의 K359, K425 row가 userland framework 위 애플리케이션의 예로 framework 제품이 아닌 PHP console application을 든다 (K477). red: 수정 전 make text-absent FILE=PRINCIPLES.md TEXT="Symfony Console CLI"가 exit 2, green: 수정 후 같은 실행 (K477).
- `dependency-policy-check`가 `--packages <name,...>`(`make dependency-policy-check PACKAGES=`)를 받으며, 그 패키지 이름을 가진 finding만 보고하고 실패한다. 범위 없는 gate는 그대로다(K493).
- `make npm-install`은 `ADD=<checkout>...`을 받아, 프로젝트가 선언하지 않은 패키지의 폴더도 처음부터 link한다. 임시 manifest의 file: 의존성이며, 추적 package.json과 package-lock.json은 그 패키지를 이름 짓지 않는다(K485).
- K491: 의존성 테스트 fixture는 make의 mise 설정이 아니라 자신의 테스트 환경에서 돈다. MISE_LOCKED을 빼고, fixture 도구는 checkout의 var/tools 밖에서 PATH가 찾는 것을 쓰므로 checkout의 shim이 mise로 재귀하지 않는다 (K491). Red: make 아래 make item-red ID=K491이 exit 1(go shim 재귀, lockfile에 없는 ruff); green: make 아래 make item-test ID=K491 통과, lint-ts 통과. (K491).
- K205 테스트 link는 install-packages가 `npm-install DIR=.`를 실행하고 npm-install이 `npm ci`를 실행함을 단정한다. K448-8 이후 kit-bootstrap의 설치 레시피이며, 낡은 `$(NPM) ci` 줄을 대체해 테스트가 main에서 통과한다 (K500).
- K448-5-1: `make cargo-fetch`는 소비자의 Cargo.lock이 이름하는 sibling crate만 patch하므로, 사용하지 않는 crate가 추적 lock에 patch.unused 항목을 남기지 않고 --locked가 이를 받는다 (K448-5-1). Red: `node --test --test-name-pattern=K448-5-1 tests/kit/link.test.mts`가 f57380a8에서 실패했고(이름 없는 crate에 patch가 쓰였다), green은 K448, K489, K440 테스트가 통과한다.
- `make link`는 대상이 절대 경로이고 provider로 해석되는 npm 링크를, 링크 폴더 기준 상대 경로 링크로 다시 만든다. link가 쓰는 형식이며 kit 규칙이 정한 형식이다. 대상 형식은 `docs/operations/local-links.ko.md`에 정했다 (K326-3).
- `make npm-install`은 패키지 폴더를 가진 checkout에서 그 폴더들을 받고 checkout 자신은 받지 않는다. 그래서 package.json이 패키지 이름을 가진 root(ordered-json)도 packages/js를 link한다(K494-2). Red: `node --test --test-name-pattern=K494-2 tests/kit/npm-install.test.mts`가 f57380a8에서 root를 link하며 실패했다.
- `make npm-install`은 lock에만 transitive로 있고 release URL을 가진 sibling 패키지를 file: 의존성으로 선언해 연결하므로 release를 받지 않는다(K484).
- `make uv-install ... STATE=<dir>`은 설치의 editable wheel을 절대 경로 폴더 STATE 아래에 쓴다. 그래서 읽기 전용으로 mount된 원본 checkout에는 아무것도 쓰지 않는다. STATE가 없으면 wheel은 지금처럼 소비자의 var/link에 있고, 상대 경로 STATE는 거부한다(K488). Red: 5d6f9a96에서 `node --test --test-name-pattern=K488 tests/kit/uv-install.test.mts`가 소비자 var/link의 mkdir에서 EACCES로 실패했다.
- `make npm-install`은 npm 패키지를 제공하지 않는 `CHECKOUTS` 항목(예: PHP 전용 fork)을 받고, 같은 목록을 받는 `link`처럼 그것에서는 아무것도 link하지 않는다. 존재하는 디렉터리가 아닌 항목만 거부된다(K494-1). Red: `node --test --test-name-pattern=K494-1 tests/kit/npm-install.test.mts`가 2fbe521f에서 composer 전용 checkout을 거부하며 실패했다.
- K489: `make cargo-fetch`는 sibling checkout의 crate를 그 checkout이 저장소(config/release.json)를 선언하거나 소비자의 Cargo.lock이 그 crate 중 하나를 이름 붙일 때만 patch하므로, 소비자 옆의 무관한 polyspec checkout이 "declares no repositoryUrl"로 fetch를 멈추지 않는다 (K489). Red: 수정 전 `node --test --test-name-pattern=K489 tests/kit/link.test.mts`가 그 오류로 실패했고, green은 같은 명령이 1/1 통과한다.
- `make npm-install`은 `CHECKOUTS`로 저장소 root를 받고, sibling checkout처럼 packages/ 아래 패키지 폴더를 스스로 찾는다. 그래서 소비자는 link할 checkout을 넘길 뿐 제공자의 구조를 읽지 않는다. 패키지 폴더도, 패키지 폴더를 가진 root도 아닌 checkout은 거부된다(K494). Red: `node --test --test-name-pattern=K494 tests/kit/npm-install.test.mts`가 ce55629e에서 "is a repository root, not a package folder"로 실패했다.
- `make item-red BEFORE=`는 추가된 새 모듈이 없어서만 나는 red를 거부한다. 실패한 모든 실행이 change가 추가하고 `<rev>` tree에 없는 파일만 가리키면 옛 동작의 red가 아니므로, 거부 메시지가 그 파일을 이름으로 밝히고 양쪽에 있는 진입점으로 테스트하라고 안내한다 (K389-3).
- `make uv-install`은 프로젝트가 이름을 선언한 각 checkout을 이름과 무관하게 처음부터 link하고 sync에서 그 이름으로 제외한다. 그래서 limepie-contracts라는 sibling은 release가 되지 않는다. `SYNC="<flags>"`는 uv sync에 `--no-install-project`와 `--all-groups`를 전달하고 다른 flag는 거부한다(K487). Red: 747470df에서 `node --test --test-name-pattern=K487 tests/kit/uv-install.test.mts`가 실패했다. limepie-contracts checkout이 release로 설치되었고, SYNC flag는 무시되었다.
- K442 완료: row가 이 commit에서 [o]이다. red는 cc8707a9^(수정 전 commit)에서 실행한 K442 테스트이다. 수정 전 item-edit는 CAUSE와 RETRY를 받지 않아 테스트가 `[plan] VERIFICATION is empty`로 실패하며 exit 1이다 (`make item-red BEFORE=cc8707a9^`로 기록). green은 이 commit의 K442 테스트이다 (K442).
- `npm-install`은 기존 node_modules의 내용을 바꾸고 디렉터리를 유지하므로, mount point인 node_modules도 설치된다(K486).
- K439-6: composer-provider-entries는 tracked 버전이 잠긴 요구를 깨뜨릴 때(polyspec/orm이 고정한 fork 등) Composer writer가 고른 버전을 쓴다 (K439-6). K468-2의 규칙은 link-owner 판정에 따라 잠긴 요구를 모두 만족하는 tracked 버전으로 좁혀진다. Red: node --test --test-name-pattern=K439-6 tests/kit/dependency-review.test.mts가 exit 1(tracked 1.0.0이 유지됨); green: make 아래에서 owner 파일 31/31 통과, lint-ts 통과. (K439-6).
- `make composer-install`은 `NO_DEV=1`을 받아 추적 lock을 `--no-dev`로 설치한다. production 설치에 쓴다(K483-2).
- `composer-install`과 `npm-install`은 checkout이 없는 선언된 polyspec 패키지를 모든 모드에서 패키지 이름을 적어 거부하며, 그 대신 npm ci나 composer install을 실행하지 않는다(K483-1).
- K448-13: npm-install은 packages/ 아래 세 단계까지 형제 패키지를 찾으므로, 패키지를 packages/server/ts에 둔 저장소(hyper)가 그것을 제공하고 npm은 릴리스를 가져오지 않는다 (K448-13). Red: node --test --test-name-pattern=K448-13 tests/kit/npm-install.test.mts가 exit 1(링크되지 않고 npm ci가 가져옴); green: make item-test ID=K448-13 통과, npm-install 파일 10/10, lint-ts 통과. (K448-13).
- PHP 애플리케이션 패키지(composer type project)는 S10 extension 실행 밖에 있고 test-php에서 자기 패키지로 test를 실행한다(K433).

### 2026-10-21 — worktree-setup이 link-state-check 전에 패키지를 빌드한다 (K482)

- K460은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 progress 변경을 stash한 상태에서 실행한 K460 테스트이며, green은 이 커밋의 K460 테스트다 (K460).
- 스킵된 테스트가 있는 run은 실패하고 각 스킵 케이스의 이름을 말한다. `run-tests`는 요약 줄에 `skipped cases: <이름>`을 출력하고 실패한 테스트와 같이 exit 1을 낸다. 스킵은 검증이 아니므로이다 (K460). 모든 테스트가 스킵한 run도 실패한다.
- K457 완료: row가 이 commit에서 [o]이다. red는 fix를 stash한 상태의 K457 테스트 실행(make 변수 `$`가 확장되어 `run  and $HOME`로 저장됨, exit 1)이고, green은 이 commit의 K457 테스트이다 (K457). `make item-new`와 `make item-edit`은 각 text를 작성된 그대로 도구에 넘기므로, 달러 기호·괄호·따옴표가 확장 없이 checklist에 기록된다 (K457).
- `make uv-install DIR=<project> CHECKOUTS="<checkout>..."`은 consumer의 uv 환경을 uv sync 대신 설치한다. checkout이 제공하는 polyspec 패키지는 sync에서 제외되고 그 checkout의 editable link로 설치되므로 polyspec release는 설치되지 않으며, checkout이 없는 선언된 polyspec 패키지는 uv를 실행하기 전에 거부된다(K448-3). Red: 428ec1f7에서 `node --test --test-name-pattern=K448-3 tests/kit/uv-install.test.mts`가 "does not provide an export named 'uvInstall'"로 실패했다.
- K439-5: composer-provider-entries는 Composer writer가 path repository에 쓰지 않는 source와 notification-url을 tracked lock 항목에서 보존하므로, provider 항목은 기록된 release source를 유지한다 (K439-5). Red: node --test --test-name-pattern=K439-5 tests/kit/dependency-review.test.mts가 exit 1(source 소실); green: make 아래에서 파일 30개 통과, K439-5 포함, lint-ts 통과. (K439-5).
- `scripts/kit/worktree-setup.mts`가 `make install` 뒤, `make link-state-check` 앞에 worktree의 link rebuild(`link rebuild .`, K482)를 실행하므로 새 worktree가 빌드되어 오래됨으로 보고되지 않는다 (K482). rebuild는 worktree가 가진 link 도구를 쓴다: kit 자신의 `scripts/kit/link.mts`, 또는 소비자의 설치된 `node_modules/@polyspec/kit/dist/link.mjs`. K348 fixture에는 소비자 도구를 넣었다. Red: `node --test --test-name-pattern=K482 tests/kit/worktree-setup.test.mts`가 9f7954d54d16에서 수정 전 실패(rebuild 없음, 검사가 빌드를 읽음); green: 통과, `tests/kit/worktree-setup.test.mts` 전체도 통과.
- commit-msg 검사는 code, test, script나 recipe를 스테이징한 docs나 chore commit을 경로와 함께 거부하므로, 수정은 자기 type으로 커밋한다(K449).
- `make npm-install`은 임시 manifest 사본으로 설치하므로 프로젝트의 상대 file: 의존성을 프로젝트 폴더 기준 절대 경로로
  npm에 주고, 설치 뒤에도 그 link가 풀린다(K448-12).
- 체크아웃을 주지 않은 `make npm-install`은 각 형제 저장소의 루트뿐 아니라 패키지 폴더(packages/<x>)에서도 제공 패키지를
  찾으므로, npm ci를 실행하지 않고 template/packages/ts의 @polyspec/template을 link한다(K448-11).
- K481: 생성된 Composer link manifest는 linked exact version을 caret range로 표현하고 각 path repository에는 provider의 실제 version을 유지하므로 tracked manifest를 바꾸지 않고 strict validation을 통과한다. real Composer test는 stale link lock과 일반 exact-version manifest warning이 계속 validation을 실패시키는 것을 증명한다 (K481).
- K480: Python editable wheel은 named mapping과 함께 선언된 default package-dir로 해석되는 listed package를 허용하고 import root와 finder를 모두 보존하며 default 없이 mapping되지 않은 package는 계속 거부한다. Red: 수정 전 mixed-mapping 두 case가 missing-prefix 거부로 실패했다. Green: focused regression 세 개가 모두 통과했다 (K480).
- K479: 생성된 Composer link requirement는 provider의 exact version을 사용하고, 없거나 잘못된 provider version을 거부하며 선언된 constraint와 tracked manifest를 보존한다. 선언되지 않은 package의 path repository도 오래된 tracked lock 대신 같은 provider version을 사용하며, fork는 충돌을 검증한 linked-provider의 exact pin을 유지한다 (K379-2). Red: focused regression은 `0.0.1` 대신 `*`를 보고했고, 최종 baseline 실행은 behavioral failure 7개를 기록했다. Green: K379-2를 포함한 focused K479 test 12개가 모두 통과했다 (K479).
- K476: Go workspace discovery와 go.mod/go.work reader는 checkout mise shim을 checkout의 mise environment로 실행하여, dependency-review가 managed Go shim을 가공되지 않은 process environment로 호출하지 않게 한다 (K476).
- K435-1: Go와 PyPI targeted release에 registry 검증과 정확한 update plan의 focused test를 추가하고, completeness test가 모든 target-release handler의 coverage를 맞춘다 (K435-1).
- K439-3-1: K439-3 real-Composer test는 checkout이 선언한 Composer를 사용하고, 없으면 skip하지 않고 install-tools 수정을 안내하며 실패한다. Verification은 run-tests를 거쳐 skipped-only case를 거부한다 (K439-3-1).
- K468-2-1: Composer regression fixture는 parsed lock entry를 unknown element로 검증하여, unsafe JSON assignment 없이 `make lint-ts`를 통과한다 (K468-2-1).
- K468-2: provider에 version 선언이 없으면 오프라인 Composer provider-entry 해석은 sibling package의 exact version requirement를 사용한다. Composer가 strict requirement를 해석하고, 다시 쓴 tracked lock의 version 필드는 기존 값을 유지한다 (K468-2).
- K468-1: consumer workspace와 sibling이 같은 package name을 제공하면 provider 탐색은 consumer의 own package를 유지한다. sibling이 duplicate-provider 오류를 일으키거나 소유권을 가져가지 않는다 (K468-1).
- K464-2: commit된 main을 읽지 못하는 sibling 또는 commit된 HEAD가 없는 checkout은 progress-only 출력 대신 shared-pin finding으로 실패한다 (K464-2).
- K464-1-1: shared-pin 비교를 commit된 tracked source로 옮긴 뒤 사용하지 않는 working-tree source reader와 import를 제거했다. `make lint-ts`가 통과한다 (K464-1-1).
- K464-1: sibling rule은 현재 checkout의 commit된 HEAD와 각 sibling의 commit된 main에서 추적되는 Composer pin을 비교하며, 생성된 Composer link 파일과 분리한다. Link 파일은 K326-2의 runtime platform 및 validation rule에서 계속 판단한다. K464 focused test는 생성된 link 불일치, 실제 tracked 불일치, commit되지 않은 tracked lock 수정을 검증한다 (K464-1).
- K475: provider 항목은 추적되는 composer.lock의 소비자 `vcs` repository를, `origin`이 같은 저장소를 가리키는 형제 checkout을 path repository로 삼아 해석하므로, `make dependency-review UPDATE=1`은 COMPOSER_DISABLE_NETWORK 아래에서 오프라인으로 실행된다. 형제 checkout이 가리키지 않는 vcs repository는 이름을 붙여 실패한다. red: 수정 전 `tests/kit/dependency-review.test.mts`의 K475 테스트가 실패한다(Composer가 오프라인에서 repository에 닿지 못함) (K475).
- K469-1은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 가드를 stash한 상태에서 실행한 K469-1 테스트(install-tools가 심볼릭 링크 var를 통해 기록했다)이며, green은 이 커밋의 K469-1 테스트다 (K469-1). `make install-tools`는 심볼릭 링크인 var를 거부하여, worktree가 자신의 var/tools와 mise 상태를 유지한다.
- K469는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K469 테스트(스테이징 트리에 mise.toml의 신뢰가 없어 mise가 거부한다)이며, green은 이 커밋의 K469 테스트다 (K469). main 커밋 또는 land의 스테이징 트리는 자신의 mise.toml을 체크아웃의 mise 상태에 신뢰로 기록하고, 트리를 제거하기 전에 그 신뢰를 제거하여, 신뢰되지 않은 설정을 mise가 거부하는 대신 게이트가 그곳에서 실행된다.
- K474는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K474 테스트(기준선이 `Error 127`로 실패한 게이트가 HEAD에서도 실패한 것으로 통과했다)이며, green은 이 커밋의 K474 테스트다 (K474). 환경 사유로 실패한 게이트 실행(신호, `Error 126` 또는 `Error 127`, 또는 발견 줄 없음)은 자체 출력과 함께 거부되며 기준선과 비교되지 않는다.
- K454는 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 fix를 stash한 상태에서 실행한 K454 테스트이며, green은 이 커밋의 K454 테스트이다 (K454).
- deadline에 실행 중인 테스트가 남은 node 파일은 종료하기 전에, 테스트가 시작한 자식 프로세스를 모두 멈춘다. 그룹의 리더가 되는 자식도 포함한다 (K454). `stopGroup`은 그룹 신호를 보내기 전에 그룹 밖의 run 자손을 같은 방식으로 멈춘다. 자기 그룹의 리더인 자손은 그룹 리더가 끝나면 launchd로 재부모화되기 때문이다 (K454).
- K465 완료: row가 이 commit에서 [o]이다. red는 수정 전 K465 테스트 실행(root의 workspace가 빠지고 exit 0)이고, green은 이 commit의 K465 테스트이다 (K465). `make npm-install`은 root가 선언한 workspace를 임시 manifest에 project 기준으로 유지하므로 그 link가 project 폴더를 가리킨다. 임시 폴더는 tmpdir()의 실제 경로 아래에 만든다. npm은 /var에서 /private/var로 넘어가는 경로의 workspace를 버리기 때문이다. install 후 project에 dangling link가 남으면 실패한다 (K465).
- K473: vendored gates workflow는 config/polyspec.json이 선언한 각 저장소를 프로젝트 옆에 기본 브랜치로 설치 전에 clone하고, gates 전에 `make link`를 실행한다. 선언은 `repository`를 owner/name으로 명시하므로(schema), 0.0.x polyspec 패키지를 가진 저장소의 CI가 link 모델에 필요한 sibling checkout을 갖는다. Red: 수정 전 `tests/kit/gates-workflow.test.mts`와 `tests/kit/polyspec-lock.test.mts`의 K473 test가 실패한다 (K473).
- K437-1은 이 커밋에서 done으로 기록된다: 항목이 [o]이고, red는 이전 단정으로 실행한 K437-1 테스트이며, green은 이 커밋의 K437-1 테스트이다 (K437-1).
- top-level await가 끝나지 않는 node 파일의 K437 테스트는 run이 보고하는 deadline 메시지를 받아들인다. run-tests의 gap watch(K371-1)가 같은 deadline에 run을 먼저 끝내며 `no test started within 2 s`를 보고하므로, run-tests 아래에서 나타나지 않는 파일 쪽 문구를 확인하던 테스트가 실패했다. 테스트는 이제 run이 deadline에 exit status 1로 끝나고, 파일 이름과 두 deadline 메시지 중 하나를 포함하며, 제한 전에 끝나는 것을 요구한다 (K437-1).
- K380-2-1: K380-2 amend 테스트의 fixture commit이 fixture tree가 갖고 있는 row `T1-1`만 적는다. 그래서 `commit-row`는 main에서 통과하고 테스트는 자신이 이름을 붙이는 amend를 검사한다 (K380-2-1). red: `node --test --test-name-pattern=K380-2 tests/kit/git-hooks.test.mts`는 66a4fb26에서 exit 1이다(commit-row: subject이 K380-2를 적음). green: `make item-test ID=K380-2-1`이 통과한다(1 test, none skipped) (K380-2-1).
- K468는 이 커밋에서 done으로 기록된다: 항목이 [~]에서 [o]로 바뀌고, 그 changelog 줄은 위의 줄이다 (K468).
- K468는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K468 test 실행이고 green은 이 커밋의 K468 test입니다 (K468). 추적되는 Composer, npm, pylock 파일은 0.0.x polyspec 패키지를 이름으로 적지 않는다. 선언은 config/polyspec.json에 있고, `make polyspec-lock-check`가 추적되는 이름을 실패시키며, link는 선언된 각 패키지를 형제 checkout에서 설치한다 (K468).
- K464: `make dependency-policy-check`의 sibling 규칙은 direct dependency의 버전 불일치를 config/dependency-review.json의 reviewed target에서 벗어난 체크아웃만 보고하며, 둘 다 target에 있고 target이 다르면 둘 다 보고한다. sibling은 commit된 main에서 읽고, 읽을 수 없는 sibling은 not evaluated로 명시한다. finding 문장에는 review 날짜가 없고 날짜는 progress 출력에 남는다 (K464).
- K455은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K455 test 실행이고 green은 이 커밋의 K455 test입니다 (K455).
- `config/rebuild.json`은 `make rebuild-check`가 읽는 23개 tool마다 class를 정하므로 검사는 main에서 통과하고, class가 없는 tool은 경로와 함께 실패합니다. composer-constraint 재구축 기록(`docs/rebuild/composer-constraint.md`)은 그 근거인 npm 검색을 이름으로 적습니다 (K455).
- K404-1-1: main의 commit gate는 `make land`가 읽는 같은 sibling checkout으로 문서 check를 실행한다. index의 임시 snapshot은 시스템 임시 폴더가 아니라 checkout 옆에 놓이므로 `check-documents`는 sibling의 kit checklist를 land와 같이 해석하고, kit checklist가 갖지 않은 kit 항목을 이름으로 적는 row는 main에서 거부된다 (K404-1-1). red: `node --test --test-name-pattern=K404-1-1 tests/kit/git-hooks.test.mts`는 b0a99e5c에서 exit 1이다(main의 commit이 수락됨). green: `make item-test ID=K404-1-1`이 통과한다(1 test, none skipped) (K404-1-1).
- K453은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K453 test 실행이고 green은 이 커밋의 K453 test입니다 (K453).
- `make land`는 fast-forward 뒤 메인 체크아웃에서 `make build`를 실행해 무시되는 dist/가 병합된 소스를 담게 하며, 빌드 실패는 land를 실패시킵니다. `link-state-check`는 오래된 빌드의 연결된 npm provider를 이름과 함께 실패시킵니다 (K453).
- `make land`는 worktree의 프로세스를 `lsof -nP`로 읽습니다. 이름 조회를 건너뛰어 호출당 5.6초가 0.4초가 됩니다 (K453).
- K459는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K459 test 실행이고 green은 fix 커밋의 K459 test입니다 (K459).
- K459: `make land`은 변경된 경로가 dependency manifest 또는 lock(`package.json`, lock 파일, `pyproject.toml`, `Cargo.toml`, `go.mod`, requirements 파일)이면 `dependency-policy-check`를 실행하며, 저장소의 owner 선언이 무엇을 적었든 그렇다. `owner-check`가 `scripts/kit/dependency-files.mts`의 glob을 선언에 덧붙이므로, `package.json`의 변경은 review 항목 없이 land되지 않는다 (K459). red: `node --test --test-name-pattern=K459 tests/kit/land.test.mts`는 b0a99e5c에서 exit 1이다(`package.json`이 gate를 고르지 않음: missing expected exception). green: `make item-test ID=K459`가 통과한다(1 test, none skipped) (K459).
- K439-4-1: 추적되는 composer.lock의 provider 항목을, 그 lock에서 update 명령을 실행하기 전에 쓴다. 그래서 낡은 polyspec 항목(crudui의 polyspec/ordered-json 0.0.9처럼 이전 release의 php >=8.5)이 다른 패키지의 추적 update를 Composer의 platform 검사에서 더 이상 실패시키지 않는다. `scripts/kit/dependency-review.mts`의 `runUpdateSteps`는 plan의 전과 후에 항목을 쓴다 (K439-4-1). 붉은 확인: `node --test --test-name-pattern=K439-4-1 tests/kit/dependency-review.test.mts`가 18cf55d5에서 exit 1이다(추적 update 실패: polyspec/orm 0.0.18은 php >=8.5를 요구한다). 초록 확인: `make item-test ID=K439-4-1`이 통과한다(1 test, none skipped) (K439-4-1).
- K462는 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K462 test 실행이고 green은 이 커밋의 K462 test입니다 (K462).
- `link.mjs providers <checkout>...`은 checkout의 npm provider마다 이름, 탭, package folder를 이름순으로 한 줄씩 출력합니다. link가 provider를 읽는 규칙(제외 경로 제외, package folder를 저장소 루트보다 우선)을 따르므로, 소비자는 polyspec 패키지의 folder를 규칙을 복사하지 않고 kit에서 얻습니다 (K462).
- K439-4: composer-provider-entries는 scratch 프로젝트를 소비자 자신의 repositories로 해석한다. provided 패키지가 먼저, 그다음 소비자의 repositories이며, 그 path url은 소비자 폴더 기준으로 풀린다. packagist는 꺼진 채이고, 읽을 수 없는 소비자 path repository는 이름을 밝히고 실패한다. 그런 repository만 제공하는 root 요구(crudui, orm, template)는 더 이상 "not in remote repositories"로 실패하지 않는다 (K439-4). 붉은 확인: `node --test --test-name-pattern=K439-4 tests/kit/dependency-review.test.mts`가 3554285c에서 exit 1이다(2 of 2 실패: root 요구를 찾지 못하고, 읽을 수 없는 repository는 알아채지 못하고 통과한다). 초록 확인: `make item-test ID=K439-4`가 통과하고(2 tests, none skipped), K439-3 test도 계속 통과한다 (K439-4).
- K463은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K463 test 실행이고 green은 이 커밋의 K463 test입니다 (K463).
- `make land`의 명령줄은 함수와 같이 종료 상태와 함께 실패한 gate를 거부합니다. land.mts의 진입점은 모듈의 모든 상수가 초기화된 뒤 실행되므로, 거부된 gate가 `Cannot access 'endOf' before initialization`으로 보고되지 않습니다 (K463).
- K448-10은 done입니다. 항목은 이 커밋에서 [o]이며, red는 수정 전 K448-10 test 실행이고 green은 이 커밋의 K448-10 test입니다 (K448-10).
- `make npm-install`은 manifest의 `overrides` 항목 중 제공되는 패키지를 이름으로 가진 항목을 깊이와 관계없이 direct dependency의 checkout 폴더로 다시 씁니다. 그래서 npm은 임시 manifest를 받아들이고(`dependencies`와 `overrides`에 이름이 모두 있는 limepie node/contracts 형태에서 EOVERRIDE가 더 나오지 않음), 제공되는 패키지의 asset spec이 임시 manifest에 남지 않습니다. manifest의 다른 overrides는 버리지 않고 유지합니다 (K448-10). npm 문서(package.json, overrides): direct dependency의 override는 그 dependency와 같은 spec이어야 합니다.
- K458은 done입니다. 항목은 이 커밋에서 [o]입니다. 변경은 fix 커밋 12e458ca이고, red는 f925cb58, green은 그 커밋의 K458 test입니다 (K458).
- K458: `make dependency-policy-check`의 sibling 비교는 checkout을 폴더가 아니라 repository 이름으로 적으므로, worktree `<repo>-NAME-ID`의 finding이 main의 finding으로 읽히고 `make land`는 더 이상 이를 새 finding으로 셈하지 않는다. 이름은 `scripts/kit/link-providers.mts`의 `repositoryName`이 준다. 붉은 확인: `node --test --test-name-pattern=K458 tests/kit/dependency-policy.test.mts`가 f925cb58에서 실패한다(worktree finding이 `repo-x-K1`을 적는다). 초록 확인: `make item-test ID=K458`이 통과한다(1 test, none skipped) (K458).
- K326-2: 링크된 Composer project에서 `make dependency-policy-check`의 모든 Composer 규칙(platform, K415 잠금 요구사항, `composer validate`, 검토 기록 버전)은 `composer.link.json`과 `composer.link.lock`을 판단하고, 링크되지 않으면 추적된 파일을 판단한다. 하나의 선택 함수 `scripts/kit/composer-project.mts`를 모든 규칙과 검토가 쓴다. 붉은 확인: `node --test --test-name-pattern=K326-2 tests/kit/dependency-policy.test.mts`가 8ad71384에서 추적된 lock의 `psr/log requires php >=8.5.0` finding으로 실패하고 link lock은 깨끗하다. 초록 확인: `make item-test ID=K326-2`가 통과한다(1 test, none skipped) (K326-2).
- K404-1: pre-commit hook은 main의 각 commit에서 `make land`의 gate를 스테이징된 tree에서 실행하고, HEAD에 없는 finding일 때만 이름을 적어 거부한다. pre-merge-commit hook은 main의 merge commit을 거부하므로 main은 commit과 fast-forward로만 움직인다(K404, K446, P10, P38). `make commit`은 이 hook을 통해 gate를 한 번만 실행한다 (K404-1).
- K448-9은 done입니다. 항목은 이 커밋에서 [o]입니다. 변경은 fix 커밋 76ac1d3f이고, red는 4a420f07, green은 그 커밋의 K448-9 test입니다 (K448-9).
- `make npm-install DIR=<project> CHECKOUTS="<package folder> ..."`은 주어진 각 checkout을 도구에 전달하고, 명시 모드에서 그것을 연결합니다. 그래서 polyspec 작업 공간 밖의 소비자(TMPDIR 아래 임시 clone)가 자기 lock의 npm ci를 더 이상 실행하지 않습니다. 대신 `packages/` 아래 package folder를 가진 저장소 루트를 주면 거부하며, 거부 메시지가 그 package folder들을 밝힙니다. package.json이 없는 폴더도 거부합니다(K448-9). Red: 4a420f07에서 CHECKOUTS를 준 상태로 `node --test --test-name-pattern=K448-9 tests/kit/npm-install.test.mts`가 lock의 npm ci를 실행했습니다.
- K371-1-1은 done입니다. red는 fb5dfef0(base 9177fbab에 test를 더한 상태)에 기록되었고 green은 현재 tree에서 확인했습니다. 위 항목이 둘을 담습니다 (K371-1-1).
- K371-1-1: 테스트가 test를 보고하지 않고 event loop를 양보하지 않는 node 파일을 다룹니다. 이런 파일은 test-exit-deadline의 파일 쪽 watch가 끝낼 수 없고, 실행기의 gap watch(K371-1)가 timeout에서 `no test started within N s after <마지막 event>`와 함께 끝냅니다. handle을 쥐고 test를 보고하지 않는 파일도, name pattern이 test와 맞지 않는 경우를 포함해 같은 방식으로 끝납니다. supervisor가 본 29시간 실행은 K371-1 이전입니다. 14:42의 kit dist에는 gap watch가 없으므로 consumer를 위해 kit을 다시 build해야 합니다. Red: base 9177fbab(K371-1 source를 되돌린 상태)에서 `node --test --test-name-pattern=K371-1-1 tests/kit/run-tests.test.mts`가 실패합니다. busy 파일이 20.2 s를 돌고 `no test ran`으로 끝났습니다. Green: `make item-test ID=K371-1-1`이 통과합니다(테스트 2개, 건너뛰기 없음). supervisor의 kevent-idle 경우는 재현되지 않았습니다(보고 참조). (K371-1-1).
- K439-2-1: `tests/kit/dependency-review.test.mts`의 K439-2 test는 checkout이 mise.toml에 선언한 Composer를 쓰고(`make install-tools`가 설치), 없거나 실행할 수 없으면 "no Composer on this machine"으로 건너뛰지 않고 `make install-tools`를 가리키며 실패한다. `COMPOSER_BIN` 재정의는 없앤다(K439-2-1). Red: Composer shim을 제거한 채 `node scripts/kit/run-tests.mts node -- --test-name-pattern=entries.are.Composer tests/kit/dependency-review.test.mts`가 exit 1로 끝난다("1 skipped, no test ran"). green: `make item-test ID=K439-2-1`이 통과한다(test 1개, 건너뛰기 없음), 없는 경우는 make install-tools를 가리키며 실패한다. (K439-2-1).
- K441-1: `make land`와 `make worktree-prune`은 process의 working directory, 열린 file, executable 가운데 하나가 worktree 안에 있을 때만 그 process가 worktree에서 도는 것으로 본다(lsof로 읽으며, 이제 lsof가 필요하다). command line에만 경로가 적힌 process는 사용이 아니므로, 관계없는 `du -sh`가 land를 막지 않는다. `make worktree-prune`도 그런 process가 쓰는 merge된 worktree를 남기며, `make land`가 거부하는 것과 같다(K441-1). Red: `node --test --test-name-pattern=K441-1 tests/kit/land.test.mts`가 exit 1로 끝나고(인자만 적은 process 2개, 201과 205가 세임), `node --test --test-name-pattern=K441-1 tests/kit/worktree-prune.test.mts`가 exit 1로 끝난다(cwd가 안에 있는 process가 있는 worktree가 제거됨). green: `make item-test ID=K441-1`이 통과한다(test 2개, 건너뛰기 없음). (K441-1).
- K371-1: run-tests는 test event가 없는 모든 구간을 test별 timeout으로 제한합니다. node, vitest, go, cargo, phpunit, python 모두에 적용되며, 첫 test 전, test 사이, 마지막 test 뒤에서 timeout에 이르면 실행기는 test timeout과 같이 tool의 process group을 멈추고 실행 경과 시간과 함께 `no test started within N s after <마지막 event>`를 출력합니다. 실행은 실패합니다. 전체 실행에는 시간 제한이 없습니다. Red: bc80fb67에서 `node --test --test-name-pattern=K371-1 tests/kit/run-tests.test.mts`가 실패(4개 모두 실패: timeout을 넘겨 자는 python import와 go shim이 통과하며, gap watch module이 없음); green: `make item-test ID=K371-1`이 통과(테스트 4개, 건너뛰기 없음). (K371-1).
- kit-check는 env(할당과 option 포함), exec, command, sh/bash/zsh/dash의 -c 문자열 뒤에서 시작하는 PHPUnit과 phpunit.phar도 찾는다(K436-1). Red: 7b4825eb에서 `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts`가 실패(finding 5개 중 4개); green: 통과.
- kit-check는 make 변수를 펼쳐 읽은 recipe 명령 중 run-tests 밖에서 PHPUnit을 시작하는 명령(PHPUnit 자체, 또는 그것을 실행하는 php interpreter)을 거부한다(K436). 시간 제한을 넘긴 test의 process group을 끝내는 run-tests만 멈춘 PHPUnit test를 멈출 수 있고, PHPUnit의 enforceTimeLimit은 libpq 안에서 기다리는 test를 중단하지 못한다. Red: 변경 전 `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts`가 실패(검사가 없고 orm에 그런 명령이 37개 있다); green: 통과하며 kit의 recipe에는 finding이 없다.
- K439-3: composer-provider-entries는 Composer writer의 scratch 프로젝트를 tracked lock에서 해석한다. 소비자의 composer.json과 composer.lock이 기준이고, 제공되는 패키지는 path repository이며, Composer는 그 패키지만 오프라인으로 갱신한다. 그래서 nikic/php-parser 같은 transitive 요구는 packagist가 아니라 lock에서 온다 (K439-3). Red: node --test --test-name-pattern=K439-3 tests/kit/dependency-review.test.mts가 exit 1(lock 없이는 transitive 요구를 찾지 못함); green: make item-test ID=K439-3이 통과한다(테스트 1개, 건너뛰기 없음). (K439-3).
- `make cargo-fetch DIR=<project>`는 소비자의 Cargo crate를 `cargo fetch --locked` 대신 가져온다. sibling checkout이 제공하는 polyspec crate는 처음부터 경로로 patch되므로 sibling crate의 git tag를 가져오지 않는다. `link-state-check`는 polyspec crate가 든 lock을 가져오는 recipe를 finding으로 알린다 (K448-5).
- K435: `make dependency-review UPDATE=1 TARGETS=<file>`은 배치의 목표 버전을 registry 스냅샷 시점과 함께 담긴 JSON 파일(dependency-targets.schema.json)에서 읽는다. 이름이 있는 dependency는 정확히 목표 버전으로 옮겨지고, 이름이 없는 dependency는 그대로 남는다. registry에 없거나 PHP 정책을 깨는 목표는 어떤 dependency도 바꾸기 전에 실패하며 그 이름을 밝히고, RECORD=1은 스냅샷 시점을 기록한다 (K435). Red: node --test --test-name-pattern=K435 tests/kit/dependency-review.test.mts가 exit 1(4개 중 4개가 수정 전 실패: TARGETS를 읽지 않음); green: 같은 명령이 4개 중 4개 통과 (K435).
- K440: `link --siblings`는 kit checkout의 claude-hook을 실행하는 Bash PreToolUse hook을 workspace 폴더의 `.claude/settings.json`에 쓰고 다른 설정은 지킨다. 그 hook이 없으면 `link-state-check`가 실패하므로 workspace 폴더에서 시작한 세션도 보호된다(K440). Red: node --test --test-name-pattern=K440 tests/kit/link.test.mts가 exit 1(workspace 폴더에 hook이 없다); green: make item-test ID=K440이 통과한다(테스트 4개, 건너뛰기 없음). (K440).
- K440-2: `link --siblings`의 Claude Code hook은 kit checkout의 node가 link를 거쳐 실행 가능한 정규 파일로 resolve될 때만 그 node로 실행된다. writer와 `link-state-check`가 하나의 predicate를 공유한다. writer는 쓰기 전에 없거나 실행할 수 없는 node를 거부하고, 기존 hook을 바이트 단위로 그대로 두며 `make -C <kit realpath> install-tools`를 알린다. `link-state-check`는 drift 클래스마다 하나의 메시지로 실패한다: hook 없음, hook 내용 다름, node 없음 또는 실행 불가(K440-2). Red: `node --test --test-name-pattern=K440-2 tests/kit/link.test.mts`가 exit 1(3개 중 2개 실패: 내용 drift와 실행 불가 node가 알려지지 않은 채 통과한다); green: `make item-test ID=K440-2`이 통과한다(테스트 3개, 건너뛰기 없음). (K440-2).
- K441: `make land`와 `make worktree-prune`은 자기 worktree를 제거하기 전에 그 Makefile의 `WORKTREE_STOP` target을 실행하고, `make land`는 그 target이 실패하면 worktree를 남기고 target과 그 출력을 적어 실패한다. `make worktree-prune`은 제거된 worktree 폴더를 명령행에 적은 프로세스를 pid와 경로로 나열하며, 어떤 프로세스도 종료하지 않는다(K441). Red: `node --test --test-name-pattern=K441 tests/kit/land.test.mts`와 `node --test --test-name-pattern=K441 tests/kit/worktree-prune.test.mts`가 base에서 exit 1(서버가 멈추지 않고 프로세스가 나열되지 않음); green: `make item-test ID=K441`이 통과한다(테스트 3개, 건너뛰기 없음).
- `make npm-install`은 주어진 checkout이 제공하는 패키지를 origin과 상관없이 연결하고, lock에만 transitive로 있는 패키지는 override로 연결하며, checkout이 없는 선언된 polyspec 패키지는 npm ci 대신 실패한다(K448-7).
- K439-2: composer-provider-entries는 provider 항목을 Composer 자체의 lock writer로 오프라인에서, 소비자가 선언한 플랫폼으로 쓴다. 그래서 자기가 쓴 lock을 다시 실행해도 바뀌지 않고, 플랫폼보다 많이 요구하는 provider는 둘을 함께 적고 실패한다 (K439-2). Red: node --test --test-name-pattern=K439-2 tests/kit/dependency-review.test.mts가 exit 1(manifest의 license 형식); green: make 아래에서 make item-test ID=K439-2가 통과한다(툴체인 Composer, 테스트 2개, 건너뛰기 없음). (K439-2).
- K440-1: kit은 `link`가 각 Go module에 쓰는 `go.work`와 `go.work.sum`을 무시한다. kit 자신의 도구(scripts/kit/symbols/go)도 포함하므로, `link`가 K440의 workspace hook을 쓰기 전에 "not ignored by Git"으로 실패하지 않는다(K440-1). Red: `node --test --test-name-pattern=K440-1 tests/kit/link.test.mts`가 exit 1로 끝난다(scripts/kit/symbols/go/go.work가 무시되지 않음). green: `make item-test ID=K440-1`이 통과하고, checkout에서 `make link`가 hook을 쓴다.

### 2026-10-21 — install-packages가 make npm-install로 설치한다 (K448-8)

- `scripts/kit/kit-bootstrap.mk`의 `install-packages`는 모든 소비자의 `make install`이 거치는데, 맨 `npm ci` 대신 `make npm-install DIR=.`를 실행한다 (K448-8). 그래서 lock이 release URL로 고정한 형제 checkout 제공 polyspec 패키지가 처음부터 링크되고 release는 받지 않는다. Red: `node --test tests/kit/install-packages.test.mts`가 base에서 실패(recipe가 `npm ci`를 실행); green: 통과, `tests/kit/npm-install.test.mts`도 통과.
- `make composer-install`과 `make npm-install`은 kit.mk의 다른 설치 대상처럼 온라인으로 실행되므로, 검사를 위해
  COMPOSER_DISABLE_NETWORK나 npm_config_offline을 내보내는 consumer도 lock의 서드파티 패키지를 설치한다(K448-6).
- `make npm-install DIR=<project>`는 consumer의 npm 패키지를 npm ci 대신 설치한다. sibling checkout이 제공하는 polyspec 패키지는 임시 manifest로 처음부터 link되고, release를 받지 않으며 추적 파일도 쓰지 않는다(K448-2).

### 2026-10-21 — 매핑된 package-dir prefix가 나열된 하위 패키지를 링크한다 (K398-3)

- K448-5: K448-5를 항목으로 등록한다: cargo는 polyspec checkout의 형제 crate를 [patch] 경로로 처음부터 링크하므로 로컬 설치가 release crate를 물질화하지 않는다(K448의 cargo 부분). red와 green은 link 테스트와 함께 온다. (K448-5).
- `scripts/kit/link.mts`가 `.`에 매핑된 prefix를 가진 정적 `package-dir`를 받아들인다. `setuptools.packages`에는 하위 패키지만 나열한다 (K398-3): 나열된 패키지는 자기가 시작하는 가장 긴 package-dir prefix로 풀리고, 편집 가능 wheel의 finder는 이름을 가장 긴 prefix로 매핑하며 prefix의 상위 패키지에는 자기 폴더가 없는 namespace 패키지를 준다. 그래서 `limepie.module.x.src`가 폴더로 풀리고 거기에는 아무것도 쓰지 않는다. 어떤 prefix도 매핑하지 않는 나열 패키지는 여전히 거부한다. Red: `node --test --test-name-pattern=K398-3 tests/kit/link.test.mts`가 f6e6f254a6b2에서 수정 전 실패(링크가 package-dir를 거부); green: 통과, 나머지 K398 테스트도 통과.
- K379-2: 링크는 소비자나 연결된 provider가 요구하는 정확한 고정 버전(require와 require-dev)을 tag로 써서 fork를 연결하고, 두 고정 버전이 다르면 둘을 함께 적고 실패한다 (K379-2). Red: node --test --test-name-pattern=K379-2 tests/kit/link.test.mts가 exit 1(link manifest가 lock 버전 2.6.0을 씀); green: link 테스트 파일 82개 전부 통과, K379-2 포함. (K379-2).
- main의 `make commit`은 `make land`처럼 gate의 finding을 읽고 kit 도구가 대괄호 이름으로 찍는 진행 줄은 빼므로, HEAD와 다른
  진행 줄이 commit을 거부하지 않는다(K446-4).
- `make land`와 main의 `make commit`은 각 gate를 `make -s`로 실행하므로, checkout마다 다른 make의 recipe 출력 줄을
  HEAD에 없는 finding으로 읽지 않는다(K446-3).
- K439-1: composer-provider-entries는 각 composer.lock의 platform과 platform-overrides를 그 디렉터리의 composer.json에서 다시 계산하고, release-consumer lock은 건드리지 않는다 (K439-1). Red: node --test --test-name-pattern=K439-1 tests/kit/dependency-review.test.mts가 exit 1(export와 재계산 없음); green: 파일 전체 15개 통과, K439-1 포함. (K439-1).

### 2026-10-21 — 정적 package-dir는 편집 가능 wheel의 finder로 링크된다 (K398-2)

- `scripts/kit/link.mts`가 pyproject에서 패키지를 자기 폴더에 매핑하는 정적 `package-dir`를 가진 Python provider를 링크한다. 패키지는 `setuptools.packages`에 나열되어야 한다 (K398-2): 편집 가능 wheel이 패키지 이름을 폴더에 매핑하는 finder `__editable___<dist>_finder.py`를 쓰고, `.pth`가 그것을 import하여 설치한다. 폴더는 쓰지 않으며 소스는 복사하지 않는다. 정적 문자열 맵이 아닌 `package-dir`나 `setuptools.packages`에 없는 패키지 매핑은 여전히 거부한다. Red: `node --test --test-name-pattern=K398-2 tests/kit/link.test.mts`가 0ad7267f7793에서 수정 전 실패(링크가 package-dir를 거부); green: 통과, `tests/kit/link.test.mts`의 82개 테스트 모두 통과.
- `make land`와 main의 `make commit`은 체크아웃의 실제 경로와 논리 경로를 같은 키로 읽으므로, 경로만 다른 변경 없는 finding으로 거부되지 않는다(K446-2).
- main에서 `make commit`은 선택된 gate를 `make land`처럼 HEAD와 비교하고, HEAD에 없는 finding만 거부하므로 HEAD가 이미 가진 finding은 관계없는 변경을 막지 않는다(K446-1).
- lock을 composer install하는 recipe는 뒤에 link 단계가 있어도 거부되며, sibling이 제공하는 polyspec 패키지를 처음부터
  link하는 make composer-install을 쓰라고 적는다(K448-1).
- main에서 `make commit`은 스테이징된 경로에 대해 `make land`가 고르는 정적 gate를 실행하고, 하나라도 실패하면 아무것도
  커밋하지 않는다. commit-msg 검사는 HEAD가 main인 동안 커밋을 거부하지 않으므로, owner가 K404를 폐지하며 정한 대로 작업은
  main에서 직접 한다(K446).
- `make composer-install DIR=<project>`는 composer install 대신 Composer 프로젝트를 설치한다. sibling checkout이 그 lock의
  polyspec 패키지를 제공하는 곳에서는 composer.link.json과 composer.link.lock을 쓰고 그것으로 설치하므로, 링크된 패키지의
  release metadata(php >=8.5를 요구하는 polyspec/orm 0.0.18 같은)를 읽지 않는다. CI처럼 sibling이 없으면 추적 lock으로
  composer install을 실행한다. link는 새 프로젝트의 polyspec 패키지를 그 lock에서 읽는다(K432).
- kit이 쓰는 추적 composer.lock은 sibling checkout이 제공하는 각 polyspec provider의 manifest(require, autoload와
  composer.json의 다른 field)를 담고 오래된 release의 metadata를 담지 않으며, 버전, dist, source는 그대로 둔다.
  `dependency-review UPDATE=1`이 이를 적용하고, `make composer-provider-entries`는 이것만으로 모든 추적 lock을 다시 쓰므로
  어떤 lock도 release의 `php >=8.5`를 지니지 않는다(K439).
- link는 --project 아래 consumer 자신의 Python 프로젝트도 K398의 editable wheel로 --no-deps와 함께 설치하고 direct_url.json을
  그 폴더의 editable 기록으로 다시 쓰므로, container가 read-only로 mount한 checkout에 아무것도 쓰지 않는다. `uv pip install
  -e`는 남지 않으며, K398의 거부가 그것에도 적용된다(K398-1).
- fork의 링크는 consumer가 고정한 버전을 지킨다: 링크 manifest는 fork checkout의 path repository에 lock이 고정 전에 기록한
  release가 아니라 consumer composer.json의 정확한 핀을 태그로(2.6.0-p1을 v2.6.0-p1로) 주므로, Composer는 partial update에서
  forks/<name>의 fork를 받는다(K379-1).
- `./run-command`의 runCommand는 option onLine(stream, line)을 받는다. 이는 pipe된 stdout이나 stderr의 완성된 각 줄을
  도착하는 대로, stream이 끝날 때는 newline 없는 마지막 줄을 받으므로, 호출자는 출력을 maxOutputBytes 아래에서 계속 모으면서
  병렬 명령을 각자의 prefix와 함께 내보낼 수 있다(K430-1).
- checkout에 도구가 없는 parity runner나 symbol extractor는 그것을 실행의 오류, 즉 도구와 run make install을 적는 R3나 R1
  finding으로 보고하며, K393-1 이후 python3가 없는 checkout에서 그랬듯 parity-check와 parity-declarations-check를 잡히지
  않은 오류로 끝내지 않는다(K393-2).
- `make text-absent FILE=<path> TEXT=<text>`는 추적되는 파일이 그 문구를 그대로 가진 동안 각 줄을 적어 실패하고, 문구가
  사라지면 통과한다. 이는 변경 전체가 text인 행의 red이며, P19는 이제 이것과 함께 변경이 낡게 만든 주석과 문서를 그 변경의
  커밋에서 고친다는 규칙을 적는다. 문구는 환경 변수로 도구에 전해지므로 그 안의 백틱이나 `$( )`는 아무것도 실행하지 않는다
  (K431).
- `make parity-declarations-check UNITS=`는 config/parity.json의 schema finding도 범위로 좁힌다: `/units/<index>`의 finding은
  그 unit이 이름 붙었을 때만 세므로, 다른 unit이 아직 schema를 어겨도 한 unit의 requirement를 더하는 행은 red와 green을
  증명한다. 그때 실행은 다른 규칙이 schema를 통과하는 선언을 필요로 한다고 말한다(K400-1).
- kit 패키지는 `./run-command`를 export한다. runCommand는 명령 하나를 시간 제한 없이 자기 process group에서 끝까지 실행하고,
  명령이 끝나면 group에 남긴 것을, 호출자가 중단되면 실행 중인 명령을 멈추며, 출력을 한도까지 담고 status, signal, 경과
  시간, 시작 오류를 돌려준다. failureOf는 실패를 한 줄로 적고, stopGroup은 이것과 run-tests를 위해 process-group.mts로
  옮겼다(K430).
- P10은 `.githooks/pre-push`로만 강제되고, PRINCIPLES.md의 어떤 Enforced by 줄도 PRINCIPLES.md를 kit의 복사본으로 받는
  consumer에 없는 tests/나 scripts/ 아래 경로를 적지 않으므로, kit-sync 뒤에도 `make rules-check`가 통과한다(K359-2).
- `make land`는 자기를 실행한 make와 shell 같은 자기 조상을 worktree의 프로세스에서 빼므로, make land 전에 worktree로
  이동한 shell이 branch를 거부하지 않는다(K429-1).
- `make land`는 worktree에서 실행 중인 프로세스, 즉 command line이 그 안의 경로를 가리키거나(테스트 database server의
  --datadir 같은) 작업 폴더가 그 안에 있는 프로세스가 있으면, 어떤 gate도 돌기 전에 각 pid와 command를 적어 branch를
  거부한다. 그때는 아무것도 merge, 삭제되지 않는다(K429).
- `make land`는 main에서도 실패하는 gate에서 kit 도구의 진행 줄을 finding으로 세지 않는다. stderr의 모든 줄과, kit 도구 이름을
  대괄호로 시작하는 줄(`[parity] tools root ...`)을 뺀 stdout 줄을 비교하므로, linter가 stdout에 낸 finding은 여전히 센다
  (K394-3).
- `make dependency-policy-check`는 remote tarball URL(registry.npmjs.org가 아닌 http(s) `.tgz`)에서 resolve되었지만 lock
  root나 그 workspace의 어떤 package.json도 그 URL로 적지 않은 package-lock.json 항목을 lock의 줄, 패키지, URL과 함께
  실패시키므로, allow-remote=root(K189)에서 npm ci가 거부하는 일이 먼저 보인다. 고치는 방법은 그 패키지를 URL과 함께 root에
  선언하는 것이다(K427).
- `make install-packages`는 npm ci 뒤에 저장소 변수 INSTALL_PACKAGES_EXTRA가 이름 붙인 make target(예: npm workspace 밖에
  자기 package-lock.json을 가진 tools 프로젝트의 설치)을 같은 npm과 allow-remote 설정으로 실행한다. 그것들은 설치만 하고,
  `make install`이 그 뒤에 link하며, link-state-check는 그것들에 link 단계를 요구하지 않고, release workflow는
  install-packages로 그것들을 설치한다(K428).
- `make layout-check`가 실행하는 `generated-files tracked`는 생성 segment, 실행 object header 또는 생성 파일 header
  (shebang을 빼고 `Code generated .* DO NOT EDIT`와 맞는 첫 주석 줄)를 가진 추적 경로를, config/generated.json이 예외로
  선언하지 않는 한, 경로와 함께 실패시킨다. hook의 staged 검사는 hook이 생기기 전에 커밋된 파일을 볼 수 없다(K426).
- Red-Gate나 Red-Test 줄은 HEAD와 main의 merge-base를 적는다. 행 branch를 main 위로 rebase해도 그 커밋은 fix의 조상으로
  남으므로, branch에서 red를 기록한 행도 `make land`가 요구하는 rebase 뒤에 닫힌다. 또 `make item-red BEFORE=`는 행을 닫으며
  바뀐 changelog를 가진 tree를 받는다(K389-2).
- `make item-red BEFORE=`는 바꾸는 각 파일의 바이트와 함께 mode를 복구하므로, BEFORE에 없는 Git hook 같은 실행 파일이 실행
  가능한 채로 돌아온다(K389-1).
- P24는 `make commits-check`를, S10은 `make dependency-policy-check`를, 즉 K424와 K425가 만든 검사를 planned 항목 대신
  적으므로 `make rules-check`가 main에서 다시 통과한다(K359-1).
- `make commits-check`와 commit-msg hook은 id `(#<id>)`가 그 커밋 tree의 docs/plans checklist 항목이 아닌 커밋을 실패시키므로
  (규칙 commit-row), 변경은 등록된 행에서 시작한다(P24). 행을 등록하는 커밋은 그 행을 더하므로 통과하고, 저장소의 첫 커밋은
  예외다(K424).
- `make dependency-policy-check`는 composer.json의 require에 애플리케이션 framework(symfony/console,
  symfony/framework-bundle, symfony/http-kernel, laravel/framework, laminas/laminas-mvc)를 요구하는 S10의 PHP library를
  manifest와 패키지 이름과 함께 실패시킨다. 애플리케이션은 library를 요구하는 자기 Composer 패키지다(K425).
- `make parity-declarations-check IDS="<requirement>..."`는 requirement id 중 하나를 가리키는 finding만 UNITS, RULES와의
  교집합으로, config/parity.json 자체의 finding과 함께 보고한다. 어떤 unit도 인용하지 않는 id는 실행을 실패시키므로, 몇
  requirement의 인용을 옮기는 행도 red를 증명할 수 있다(K414-1).
- link는 kit이 build backend 없이 consumer의 `var/link/python`에 직접 쓰는 editable wheel로 Python provider를 설치한다.
  wheel은 provider pyproject.toml의 metadata와 import root를 가리키는 .pth만 담고 source는 담지 않으므로, link는 container가
  read-only로 mount한 provider 폴더에 아무것도 쓰지 않는다. metadata에 backend가 필요한 provider는 `uv pip install -e`로
  대체하지 않고 거부한다(K398).
- php, node, npm, composer, go, python, uv를 실행하는 kit의 모든 도구는 하나의 helper(mise-tools.mts의 `toolCommand`:
  `var/tools/bin`, 다음 checkout의 mise shim)로 checkout에서 그 도구를 가져오며, 없으면 PATH로 대체하지 않고 run make
  install과 함께 실패한다. bootstrap npm installer는 machine의 node를 쓰고, cargo는 PATH에 남는다(K393-1).
- `make dependency-policy-check`는 저장소와 sibling checkout이 모두 직접 요구하는 패키지의 핀을 각 root의 install lock에서
  비교하고, 다른 version이나 다른 source로 lock된 패키지를 두 lock과 그 entry의 줄과 함께 실패시킨다. 전이 패키지와 tests/나
  fixtures/ 아래의 lock은 비교하지 않으며, CI처럼 sibling이 없으면 아무것도 비교하지 않는다(K378).
- PRINCIPLES.md는 owner의 작업 지침을 그 검사와 함께 적는다: 작업은 `make land`로만 main에 들어가고(P10, P38), 행마다
  자유 디스크 30 GB 이상에서 만든 worktree를 merge 뒤 지우며(P10), 전체 suite는 conductor의 지시로만 돌고(P20),
  subagent는 Haiku 5.5에서 행 하나씩 맡고 결과를 검증받으며(P22), 행이 작업보다 먼저이고(P24, planned K424), 미루지 않으며
  (P36), 결과는 검사 뒤에만 보고하고(P37), S10의 PHP library는 library code뿐이다(planned K425)(K359).
- `make item-red ID=`는 active 행의 Verification을 test 작성 뒤, fix 전에 실행해 실패를 요구하고 기록한다. `make commit`은
  그 기록을 행의 각 커밋에 Red-Test 줄로 쓰고, `make item-state`의 done 상태는 그 기록이나 history의 그런 줄을 요구하며,
  그 줄은 rebase 뒤 parent의 조상에서도 성립한다. `make item-red ID= BEFORE=<rev>`는 기록 없이 커밋된 행의 red를 `<rev>`의
  source로 증명한다(K389).
- `config/parity.json`의 binding은 `runner`를 `reason`과 함께 선언할 수 있다. 그 test는 그 runner의 program, argument, 출력
  parser로 실행되고 R2와 R3에서 여전히 구현의 binding으로 세므로, C engine의 node test가 계약을 확인하는 PHP extension도
  binding할 수 있다. reason 없는 runner나 runner 없는 reason은 선언의 finding이다(K422).
- `link --siblings`는 checkout 옆 `forks/` 폴더의 main checkout을 origin과 상관없이 그 manifest가 이름 붙인 패키지의
  provider로 링크하며, fork는 polyspec 패키지의 0.0.x 규칙이 다루지 않는 자기 핀(예: 2.6.0-p1)으로 링크된다(K379).
- kit의 layout은 kit link가 링크된 checkout의 root에 쓰는 파일(`composer.link.json`, `composer.link.lock`)을 선언하므로,
  링크된 worktree도 main checkout처럼 `make layout-check`를 통과한다(K423).
- 실제 layout 테스트가 `make layout-check`의 install 폴더 검사와 함께 다시 통과한다. 그 fixture는 kit의 도구를 그 node로
  실행하고 install 폴더를 무시한다(K372-1).
- TypeScript 실제 lint 테스트 K170과 K172가 다시 통과한다. 그 fixture는 각 테스트가 증명하는 규칙 옆에서 더는 tsc에 실패하지
  않는다. 타입 없는 매개변수와, fixture의 tsconfig가 이제 빼는 일부러 깨진 입력 때문이었다(K417).
- `make unlink`은 `pylock.toml`로 lock한 Python project를 복원한다. 링크된 package의 lock된 release를 pylock에서 환경에 다시
  설치하고, pylock에 없는 링크된 package를 적는다(K401-1).
- docs-check는 `template-benchmark K79-3`처럼 sibling 저장소의 이름 뒤에 온 K-id를 그 저장소의 item으로 읽고, 자기 id가
  K-id인 저장소에서는 `kit K<n>`만 kit item으로 읽는다(K374-1).
- kit의 module이 자기 옆에서 읽는 파일이나 폴더를 kit-build가 dist에 담지 않으면 kit의 테스트가 실패하고, kit-build 테스트의
  sandbox는 build가 담는 폴더를 Makefile에서 얻는다(K421).
- run-tests는 표준 library만 쓰는 kit의 runner로 Python 테스트를 실행한다. runner는 테스트마다 자기 timeout을 주고 각각의
  경과 시간을 출력하므로 어떤 환경도 새 package가 필요 없다. `docs/operations/tool-inventory.md`는 언어마다 무엇이 테스트에
  timeout을 주는지 적는다(K371).
- kit의 prepare-commit-msg hook은 기록만 하는 commit에서 아무것도 출력하지 않는다. 오류는 계속 출력한다(K380-3).
- `make lint-php`는 `autoload.files` 항목의 각 파일을 PHP parser로 읽고, S2가 요구하듯 namespace의 함수와 상수가 아닌
  것이 있으면 파일과 줄을 적어 실패한다(K377).
- docs-check는 kit 자신이나 consumer 옆의 kit checkout에서 읽은 kit의 checklist에 없는 kit item을 적은 checklist row를
  그 파일과 줄을 적어 실패시킨다(K374).
- `make layout-check`는 Git이 무시하지 않는 install 폴더(`package.json` 옆의 `node_modules`, Composer project의 vendor, `var`,
  `pyproject.toml` 옆의 `.venv`)에서 그 폴더와 고칠 `.gitignore`를 적어 실패한다. Go vendor 폴더는 정당하다(K372).
- kit main에서 `make layout-check`가 다시 통과한다. `config/layout.yml`은 marker 검사의 Python helper와 PHPUnit이 앞에
  붙이는 PHP 파일을 S9에서 예외로 둔다. 그 언어의 program만 그것일 수 있기 때문이다(K420).
- test-markers-check는 자기 module 옆의 Python helper를 쓰고 kit-build는 `markers/`를 dist에 담으므로, `scripts/kit`이
  없는 consumer의 Python 테스트도 읽는다(K345-1).
- link는 linked로 보고하는 모든 Composer project의 link manifest와 lock을 쓰며, 설치된 vendor로 linked인 project도 그렇다.
  링크된 project에 그것이 없는 동안 `link check`는 실패하므로, dependency-review는 링크된 project를 링크되지 않은 것으로
  보지 않는다(K392-3).
- `dependency-policy-check`는 tracked Composer lock의 각 package를 그 `composer.json`의 `config.platform`의 `php`와
  `ext-*`로 검사하고, platform이 요구를 채우지 못하는 package를 적는다(K415).
- `link check`는 consumer module의 go.work가 쓰는 module을 그 go.work에서 읽으므로, tracked workspace의 다른 module을
  요구하지 않는 module이 더는 not a known dependency로 검사에 실패하지 않는다(K399-1).
- amend의 commit-msg 검사는 index를 amend되는 commit의 parent와 비교한다. `make hooks`가 amend를 기록하는
  `prepare-commit-msg` hook을 쓰므로, 테스트를 가진 fix commit의 문서를 다시 stage하는 amend가 통과한다. git은 `-C HEAD`에
  같은 인자를 주므로 그것도 같게 검사된다(K380-2).
- checklist는 각 row의 id로 row마다 merge된다. `make hooks`는 `docs/plans/*/checklist.md`에 driver `kit-checklist`를
  선언하고 `kit-twin`은 그 쌍둥이를 같게 merge하므로, main이 닫은 row는 branch가 그 뒤에 덧붙인 row 옆에 한 번만 남고,
  양쪽이 다르게 바꾼 row는 그 id를 적은 conflict이다(K354-3).
- `make docs-check`는 check-documents를 실행한 뒤 저장소가 `DOCS_CHECKS += <target>`으로 더한 모든 문서 검사를 다른 것의
  상태와 상관없이 실행하고, 실패한 것을 적어 실패한다(K419).
- `make dependency-review`는 Go module을 가장 가까운 go.work로 검사한다. link가 쓰는 옆의 go.work, 없으면 그 module을 쓰는
  상위 폴더의 tracked go.work를 쓰므로, 저장소 workspace의 module이 자기 module을 찾는다(K418).
- P8은 규칙마다 강제된다. phpcs는 `@`로 숨긴 오류를, oxlint는 잡은 오류를 cause로 갖지 않고 던지는 catch를, PHP
  extension의 build는 확인해야 하는 결과를 버리는 것을(`-Werror=unused-result`), gate `make suppression-check`는 이유를
  적지 않은 lint finding의 모든 억제를 거부한다(K334).
- generated file 검사는 `config/generated.json`이 선언하지 않는 한 경로와 상관없이 내용이 실행 object(ELF, Mach-O thin
  또는 fat, PE)인 파일을 거부한다. commit 때는 index에서, `commits-check`에서는 각 commit에서 읽는다(K416).
- `commits-check`는 메시지와 identity 검사 외에 pre-commit hook의 generated file 검사와 한국어 쌍둥이 검사도 범위의 모든
  commit에 실행하므로, `--no-verify`로 만든 commit은 gate와 pre-push에서 실패한다(K351).
- `make parity-declarations-check RULES="<rule> ..."`는 id나 이름으로 지정한 rule의 finding과 `config/parity.json` 자체의
  finding만 보고한다. UNITS도 주면 둘이 모두 고르는 finding을 보고한다(K414).
- Verification의 gate 명령은 `make parity-declarations-check RULES=R9`처럼 target 뒤의 make 변수를 받으므로, UNITS나
  RULES로 좁힌 gate도 fix row의 기록된 red이고 그 Red-Gate 줄이 그것을 증명한다(K357-2).
- `link rebuild`는 consumer의 링크된 Composer project마다 link 파일로 `composer dump-autoload`를 실행하므로, provider가
  파일을 지운 뒤에도 autoload는 있는 파일만 적는다(K347).
- test-markers-check는 checkout의 Python의 ast module로 Python 파일의 syntax tree에서 marker를 읽으므로, 문자열이나
  docstring 안의 skip marker는 finding이 아니다(K345).
- twin driver는 git이 `CHANGELOG.md`를 merge하는 방식대로, 그 파일의 merge attribute로 `CHANGELOG.ko.md`를 merge하고
  marker를 계산한다. hook이 아직 union으로 merge하는 checkout도 rebase 뒤 현재의 twin을 갖는다(K354-2).
- branch는 reflog가 그 위에서 만든 commit을 기록할 때 자기 commit을 가지므로, rebase로 더 새로운 main 위로 옮겨진 새
  branch를 `make worktree-prune`과 `make link-state-check`가 더는 merge된 것으로 보지 않는다(K381-1).
- run-tests는 checkout의 mise 환경(`toolsEnvironment`)으로 runner를 시작하므로, shell에서 run-tests로 실행한 owner
  테스트도 make에서처럼 checkout의 trust와 도구를 읽는다(K411).
- kit의 `make install`은 PHP symbol extractor의 package도 설치하므로(`kit-install`), `make worktree-setup`이 만든 worktree가
  `make lint-php`를 실행한다(K412).
- kit main에서 `make lint-php`가 다시 통과한다. kit의 PHP 파일 네 개에서 phpcs의 120자를 넘는 줄을 나누었고, extractor가
  보고하는 symbol과 leak은 같다(K413).
- parity 선언 검사는 요구 id를 하나도 정의하지 않는 `docs/spec`의 문서마다 그 파일을 적어 보고한다(규칙 R19
  `spec-without-requirement`)(K337).
- test-php-ext의 Reflection 비교는 extension이 등록하는 상수도 읽고, library 밖의 class나 함수에서 이미 그랬듯 PHP
  library가 정의하지 않는 상수에서 실패한다(K338).
- python-venv는 home이 main checkout의 공유 install에 있는 Python인 환경을 받는다. K387 이후 worktree는 그 Python을
  실행하므로, 새 worktree의 Python 설치가 더는 실패하지 않는다(K387-1).
- install-tools는 php, php-config, phpize 옆에 `.php-version`의 PHP의 `sbin`에 있는 `php-fpm`을 감싸고, toolchain-check는
  `php-fpm`이나 `php-cgi`를 PATH에서 bare name으로 시작하는 recipe나 script를 거부한다(K341).
- `make item-state`는 kit row를 인용하지 않는 한 release, version tag, "not reproducible", flake, "transient",
  "unrelated", "environment"를 적은 bypassed나 impossible의 사유를 거부하고, 테스트를 지우는 commit은 같은 요구를 다루는
  테스트를 적은 `Replaced-By:` 줄이 있어야 한다(규칙 `commit-deleted-test`)(K339).
- worktree는 그 저장소의 main checkout이 설치한 mise의 도구를 읽으므로(`kit.mk`와 `miseEnvironment`가 설정하는
  `MISE_SHARED_INSTALL_DIRS`) `make install`은 main checkout에 없는 도구만 설치하고, worktree마다 약 0.7 GB를 덜 쓴다.
  data dir, state, shim, wrapper는 자기 것으로 남는다(K387).
- Python link는 `uv.lock`이 없는 workspace에서 PEP 751 lock(`pylock.toml`)으로 설치의 constraint를 얻으므로, orm처럼
  그렇게 lock한 project도 그 설치가 만든 환경에 링크된다(K401).
- 변경 기록의 Unreleased 항목은 rebase 뒤에도 최신순으로 남는다. `CHANGELOG.md`는 driver `kit-changelog`로, 그 한국어
  쌍둥이는 `kit-twin`으로 merge되며, 둘은 적용되는 commit만 더한 항목을 main 목록의 형식(항목마다 한 줄, 또는 항목마다 한
  문단)대로 앞에 둔다. `make hooks`는 union 줄을 바꾼다(K354-1).
- kit main에서 `make lint-ts`가 다시 통과한다. 테스트 파일 네 개가 non-null assertion 두 개와 `any`에서의 unsafe assertion
  네 개 대신 검사나 타입이 있는 parse로 값을 읽는다(K409).
- kit main에서 `make owner-validate`가 다시 통과한다. `config/owner-checks.json`은 merge driver `twin-merge.mts`를
  `git-hooks.mts`를 통해, `clippy.toml`을 실제 Rust lint 테스트를 통해, `scripts/kit/php-library`를 그것을 읽는 module을 통해
  소유한다(K410).
- `make lint-go`는 module이 `//go:build` 줄에 적는 모든 build tag 뒤의 Go 파일을 lint한다. go 도구가 스스로 설정하는 tag를
  빼고 그런 tag마다 golangci-lint(`--build-tags`)와 deadcode(`-tags`)를 한 번 더 실행하므로, tag 뒤의 파일도 lint되고 tag가
  붙은 파일만 쓰는 helper를 더는 쓰이지 않는 것으로 보지 않는다(K406).
- kit package는 `kit.copies`가 선언하는 `clippy.toml`을 담으므로, kit-sync가 그것을 consumer에 복사하고 main에서 copy
  테스트가 통과한다(K408).
- kit main에서 `make duplication-check`와 `make lint-python`이 다시 통과한다. Python extractor의 symbol과 leak은 한 함수로
  module의 공개 이름을 읽고, extractor는 format되어 있다(K407).
- 저장소는 kit-sync가 복사하는 `config/commit-identity.json`에 commit identity를 선언하고, commit-msg 검사와
  `commits-check`는 그와 다른 author나 committer를 거부하며(규칙 `commit-identity`) clone의 `git config user.name`과
  `user.email`을 고칠 곳으로 적는다. AI identity 규칙(K265)은 남는다(K405).
- commit-msg hook은 `HEAD`가 `main`이고 `main`에 commit이 있는 동안의 commit을 거부한다(규칙 `commit-on-main`). row는
  등록과 닫기를 포함해 자기 branch에서 commit하고 `make land`의 fast-forward로만 `main`에 닿는다. `main`을 만드는 저장소의
  첫 commit만 예외이다(K404).
- `make land`는 branch와 main에서 실행한 gate의 출력을 비교하기 전에 시스템 임시 폴더 안의 모든 경로를 하나의 자리표시자로
  읽는다. 그래서 duplication-check가 실행마다 새 임시 폴더에 쓰는 jscpd 설정을 더는 새 finding으로 보지 않는다(K394-2).
- Composer project가 링크된 동안 `make dependency-review UPDATE=1`은 갱신하는 package 중 polyspec package가 아닌 것마다
  tracked `composer.lock`도 lock만으로 갱신한다. 그래서 기록한 review가 link lock이 tracked lock인 새 checkout에서도
  성립한다. polyspec package는 계속 release 검사를 기다린다(K392-2).
- `make link-state-check`는 `make install`의 사슬을 따라가기 전에 저장소의 Makefile이 대입하는 변수를 펼친다. 그래서
  `$(PACKAGE_DEPS)`를 거치는 fsm-js-install처럼 변수를 거쳐 닿는 recipe를 더는 link 단계 없는 설치로 보고하지 않는다.
  target이 여럿인 rule은 그중 하나가 닿으면 닿은 것이다(K403).
- `commits-check`는 ref에 점이 있는 범위를 받으므로, `make land`는 `chore/kitsync-T2.60`처럼 점이 있는 row id의 branch를
  land한다. 점 세 개, 빈 쪽, 점으로 시작하거나 끝나는 쪽은 계속 거부한다(K402).
- `kit.mk`와 `miseEnvironment`는 `MISE_GLOBAL_CONFIG_ROOT`를 checkout으로 설정한다. `MISE_GLOBAL_CONFIG_FILE`이 설정되어
  있으면 `mise install`은 global config의 root(기본값은 home 디렉터리)의 trust를 기록하므로, `make install-tools`가 K397이
  지운 home 항목을 곧바로 다시 썼다(K397-1).
- `make worktree-prune`은 자기 commit(reflog가 기록한 생성 지점 이후의 commit)이 모두 main에 있는 branch를 모두 지우고,
  그 worktree에 commit하지 않은 변경이 없으면 worktree도 지운다. 새 branch, merge되지 않은 branch, 변경이 있는 branch는
  이유와 함께 적는다. merge된 branch가 남아 있는 동안 `make link-state-check`는 실패한다(K381).
- `make land`는 branch에서 실패한 gate를 main에서 실행한 같은 gate의 출력에 없는 줄이 있을 때만 거부하고 그 줄을 적는다
  (worktree 폴더는 main checkout으로 읽고 숫자는 무시하며 반복 수를 센다). 새 finding이 없으면 main에서 red인 gate가 더는
  모든 branch를 거부하지 않는다. row의 Verification이 실행하는 `parity-check`와 `test-` target은 실행하지 않는다(K394-1).
- link는 바깥 Composer project의 path repository가 설치하는 package 폴더를 그 project의 일부로 보므로, 그 폴더의
  polyspec 요구를 그 project의 vendor에 링크하고, 아직 설치되지 않은 동안에는 그 vendor를 적는다(K396).
- 저장소의 tracked `go.work` 아래에 있는 module에 대해 link가 쓰는 `go.work`는 그 module과 provider 외에 그 workspace의
  모든 module을 쓴다. 그래서 링크된 동안에도 저장소의 module이 서로를 import한다(K399).
- `make parity-declarations-check UNITS="<id> ..."`는 그 unit을 가리키는 finding과 `config/parity.json` 자체의 finding만
  보고한다. 그래서 자기 unit의 선언을 고친 row는 다른 unit에 finding이 남아 있어도 통과한다. UNITS가 없으면 모든
  finding을 보고한다(K400).
- checkout의 mise 상태는 자기 `mise.toml`만 신뢰한다. `trustConfig`와 `make install-tools`는
  `var/tools/mise/state/trusted-configs`의 다른 항목(home 디렉터리, 다른 checkout, 지운 worktree로의 링크)을 모두 지우고,
  `make link-state-check`는 그런 항목을 적어 실패한다. `MISE_GLOBAL_CONFIG_FILE`이 설정된 채 실행한 `mise trust`는 home
  디렉터리를 신뢰해 그 아래의 모든 `mise.toml`을 신뢰하게 했다(K397).
- Composer project가 linked인 동안 `make dependency-review UPDATE=1`은 `composer.link.json`에 쓰는 새 범위를 tracked
  `composer.json`에도 쓴다(tracked manifest로 `composer require --no-update`). tracked lock은 release 검사를 기다린다.
  red: 범위가 link manifest에만 쓰였다. green: `node --test --test-name-pattern=K392-1 tests/kit/dependency-review.test.mts`가
  통과한다 (K392-1).
- `make test-php-ext CASES=<pattern>`은 각 PHP library에서 filter가 고르는 test를 그 library run의 명령으로 실행한
  PHPUnit 자신의 `--list-tests --filter`에서 받으므로 `#[Test]` method, data provider, 상속된 test도 센다. K390의 `function
  test…` method 읽기는 지웠다. red: 맞는 test가 접두어 없는 `#[Test]` method뿐인 library가 no case selected로 보고되었다.
  green: `node --test --test-name-pattern=K390 tests/kit/runtime-targets.test.mts`가 통과한다 (K390-1).
- `make land BRANCH=<branch>`는 branch를 main에 합친다. main에 rebase되지 않았거나 worktree가 없는 branch를 거부하고,
  그 worktree에서 바뀐 경로가 `config/owner-checks.json`으로 고르는 kit-gates의 정적 gate를 docs-check와 commits-check
  (`main..<branch>`)와 함께 실행하며 test는 실행하지 않는다. 실패한 gate의 출력과 함께 거부하고 `--ff-only`로 합친 뒤
  깨끗한 worktree와 branch를 지운다. main이 이미 가진 branch는 남은 것만 지운다. red: gate를 거쳐 branch를 합치는 utility가
  없었다. green: `node --test --test-name-pattern=K394 tests/kit/land.test.mts`가 통과한다 (K394).
- `make link-state-check`는 저장소가 polyspec 의존성을 선언하는 ecosystem에서만, 그리고 install이 마지막에 link하므로(K360-2)
  `make install`이 prerequisite나 `$(MAKE)` 호출로 이르지 않는 recipe에만 lock에서 설치한 직후 link하라고 요구한다.
  local-links.md가 둘 다 말한다. red: link할 것이 없는 kit의 `install-packages` recipe가 검사에 실패해 kit의 모든 worktree가
  red로 끝났다. green: `node --test --test-name-pattern=K349-2 tests/kit/link-state-check.test.mts`가 통과하고 kit이 검사를
  통과한다 (K349-2).
- kit checkout `../kit` 옆의 checkout에서 `kit-bootstrap.mk`는 첫 make부터 link가 설치하는 provider인 `../kit/dist`를
  `KIT`로 쓰고, build되지 않았으면 실패한다. 없으면 CI처럼 `KIT`는 설치된 package이다. 그래서 새 worktree는 `npm ci` 전에
  `kit.mk`를 읽어 kit target을 가리키는 저장소 단계가 실행되고, 자신이 개발하는 kit의 도구로 설치한다. red: 새 template
  worktree의 `make install`이 `cargo-downloads-fetch` 규칙을 몰랐고 그 install-tools가 php wrapper를 쓰지 않았다.
  green: `node --test --test-name-pattern=K348-1 tests/kit/link.test.mts`가 통과한다 (K348-1).
- `make install`은 link가 읽는 환경을 설치하는 저장소의 단계를 포함한 모든 prerequisite 뒤에 link하고,
  `install-kit`은 설치만 한다. local-links.md가 그 순서를 말한다. red: 새 orm worktree에서 install-kit의 link가 Composer
  vendor와 Python 환경이 생기기 전에 실행되어 make install을 멈췄다. green: `node --test
  --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360-2).
- `run-tests`는 PHP extension을 쓰는 phpunit run이나 library run의 php, Go run의 go, Python run의 python을
  checkout(`var/tools/bin/php`, mise의 shim)에서 시작하고, 없으면 `<path> does not exist; run make install`과 함께
  실패하며 PATH의 도구를 쓰지 않는다. red: run이 PATH의 php, 즉 make install 없는 worktree에서 pin이 아닌 PHP를 썼다.
  green: `node --test --test-name-pattern=K393 tests/kit/run-tests.test.mts`가 통과한다 (K393).
- `link`는 link lock이 없을 때만 tracked `composer.lock`에서 `composer.link.lock`을 쓰고 그 뒤에는 유지하므로, `make
  dependency-review UPDATE=1`이 link lock에 적용한 version이 다시 link해도 남고 부분 update는 linked package만 바꾼다.
  red: 두 번째 link가 갱신된 link lock 위에 tracked lock을 다시 복사했다. green: `node --test --test-name-pattern=K392
  tests/kit/link.test.mts`가 통과한다 (K392).
- 실패한 명령의 message는 비어 있지 않은 두 stream을 stderr, stdout 순서로 모두 가지므로 도구가 stderr의 진행 뒤
  stdout에 쓴 오류가 남는다. stream이 하나인 명령은 message가 그대로이다. red: stdout의 gen_stub.php 오류가 stderr의
  download 진행 뒤에서 사라졌다. green: `node --test --test-name-pattern=K352 tests/kit/process.test.mts`가 통과한다
  (K352).
- `make parity-declarations-check`는 새 rule R18 duplicate-suite로 다른 case 집합에서 같은 requirement id를 인용하는 두
  directory suite를 두 unit과 id를 말하며 보고한다. 기능은 모든 구현이 test하는 하나의 unit이기 때문이다. red: 한
  기능의 두 suite가 통과했다. green: `node --test --test-name-pattern=K350 tests/kit/parity.test.mts`가 통과한다 (K350).
- `make item-edit ID= DELIVERABLES=`는 done이 아닌 모든 상태의 item에 대해 item-new의 검사를 거쳐 두 언어의 Deliverables
  cell을 바꾼다. red: item-edit이 DELIVERABLES를 받지 않았다. green: `node --test --test-name-pattern=K388
  tests/kit/plan.test.mts`가 통과한다 (K388).
- `make commit`과 commit-msg hook은 make commit이 붙이는 id 앞에 이미 ` (#<id>)`를 가진 Subject를 거부한다(rule
  commit-subject-id). red: subject `Fix it (#T1) (#T1)`이 통과했다. green: `node --test --test-name-pattern=K380-1
  tests/kit/commits.test.mts`가 통과한다 (K380-1).
- `make link-state-check`는 recipe가 도구의 make 변수로 실행하는 lock 설치, 즉 `$(COMPOSER) install`,
  `$(COMPOSER_BIN) install`, `$(NPM) ci`, `$(UV) sync`도 읽고, 그 뒤에 kit link 단계가 없으면 실패시킨다. red: link 단계
  없이 `$(COMPOSER) install`을 가진 recipe가 통과했다. green: `node --test --test-name-pattern=K349-1
  tests/kit/link-state-check.test.mts`가 통과한다 (K349-1).
- `make hooks`는 `.git/info/attributes`에 `CHANGELOG.md`와 영어 checklist의 git union merge와 그 한국어 문서의 merge
  driver `kit-twin`(`make twin-merge`)을 선언한다. driver는 양쪽의 union과 rebase가 merge한 영어 파일의 revision
  marker를 쓰므로, changelog 줄과 checklist row를 더하는 두 branch의 rebase에 손 편집이나 script가 필요 없고 rebase가 쓰는
  각 commit은 최신 한국어 문서를 가진다. driver는 git이 적용하는 commit을 알려 주는 rebase에서 작동하고 그 밖에서는
  rebase를 말하며 실패한다. 선언이 없으면 `make hooks-check`가 실패한다. red: 그런 rebase가 두 한국어 문서에서 충돌했다.
  green: `node --test --test-name-pattern=K354 tests/kit/git-hooks.test.mts`가 통과한다 (K354).
- Claude Code hook은 `pgrep`, `pidof`, `ls`, `test`, `[`를 상태를 기다릴 수 있는 `while`이나 `until` loop의 조건이나
  본문에서만 poll로 읽는다. 목록을 도는 `for` loop는 목록과 함께 끝나므로 그것들을 실행해도 되고, `sleep`은 모든 loop에서
  계속 거부된다. red: hook이 이름 붙인 두 파일을 `test -f`로 도는 `for` loop(orm의 recipe)를 거부해 그것에 의존하는
  row에서 orm의 docs-check가 실패했다. green: `node --test --test-name-pattern=K386-1 tests/kit/claude-hook.test.mts`가
  통과한다 (K386-1).
- `make test-php-ext CASES=<pattern>`은 PHPUnit이 `--filter`를 `Class::method`에 맞추듯 `*Test.php` 파일의 `test…`
  method에서 읽어 filter가 test를 고르는 PHP library마다 실행하고, 다른 library마다 `<library>: no case selected by
  CASES`를 출력하며, 어느 library에서도 test를 고르지 못하면 실패한다. red: 한 library의 test를 가리키는 filter가 다른
  library를 실패시켰다. green: `node --test --test-name-pattern=K390 tests/kit/runtime-targets.test.mts`가 통과한다
  (K390).
- kit은 `make hooks`가 쓰는 commit-msg hook(K380)을 추적하므로 kit 자신의 commit도 만들 때 검사되고 kit에서 `make
  hooks-check`가 통과한다. red: kit에서 `make hooks-check`가 `.githooks/commit-msg`를 말하며 실패했다. green: `make
  hooks-check`가 통과한다 (K391).
- `make duplication-check`는 PHP extension의 S10 stub `packages/php-ext/src/polyspec_*.stub.php`를 경로로 제외한다. S10이
  stub에 library를 같은 이름과 signature로 선언하게 하기 때문이다. library 안의 clone은 계속 세며
  docs/operations/tool-inventory.md가 그 이유를 말한다. red: jscpd가 library class를 따라 쓴 stub을 보고했다. green:
  `node --test --test-name-pattern=K366 tests/kit/duplication-check.test.mts`가 통과한다 (K366).
- kit의 Claude Code hook은 기다리는 Bash 명령, 즉 `sleep`과 본문이 sleep하거나 poll하는(`pgrep`, `pidof`, `ls`, `test
  -e`/`-f`/`-d`, `[ -e`) `for`, `while`, `until` loop를 거부하고, 대안인 자기 작업과 timeout으로 끝나는 foreground 명령
  또는 끝날 때 알리는 background 실행을 한 message로 말한다. red: hook이 `sleep 280; echo waited`를 받았다. green: `node
  --test --test-name-pattern=K386 tests/kit/claude-hook.test.mts`가 통과한다 (K386).
- `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`은 row의 worktree, 즉 `main`에서 `<type>/<name>-<id>`의
  `../<repository>-<name>-<id>`를 만들고, 자기 source로 `make install`(도구, package, link, 그다음 저장소의 단계)을 실행해
  설치하고 `make link-state-check`로 검사한다. 여유 disk가 30 GB 미만이면 거부하고, 다시 실행하면 같은 worktree를 다시
  설치하고 검사한다. docs/operations/local-links.md는 worktree와 K360-1의 설치 순서를 말한다. red: worktree를 만드는
  target이 없어 손 작업이 필요했다. green: `node --test --test-name-pattern=K348 tests/kit/worktree-setup.test.mts`가
  통과한다 (K348).
- `link`는 소비자 자신의 저장소 package를 그것을 실행하는 work tree(main checkout이나 worktree)에서 받고, 인자 가운데
  같은 저장소의 checkout에서는 받지 않으므로 worktree는 다른 저장소만 link하고 main checkout의 source를 받지 않으며 자기
  저장소의 checkout을 밝히지 않는다. 자기 package는 `own (this repository)`로 보고된다. red: worktree의 자기 package를 main
  checkout이 제공했다. green: `node --test --test-name-pattern=K385 tests/kit/link.test.mts`가 통과한다 (K385).
- `make commit`과 check-commits의 fix 검사는 Rust unit test를 fix의 test로 받는다. commit 쪽에서 읽은 `.rs` 파일의 바뀐
  `tests.rs`, 또는 `#[cfg(test)]` item이나 `#[test]` 함수 안의 바뀐 줄이다. red: test가 `src/tests.rs`인 fix가 test
  파일을 바꾸지 않는다고 거부되었다. green: `node --test --test-name-pattern=K370 tests/kit/commits.test.mts`가 통과한다
  (K370).
- kit의 pre-commit hook과 `make commit`은 staged tree에서 읽어 commit 뒤 한국어 문서의 revision marker가 영어 문서의
  sha256이 아니게 되는 commit을 그 문서와 `make documents-stamp`를 말하며 거부한다. red: 한국어 문서의 새 marker 없이
  stage된 `CHANGELOG.md` 변경이 commit되었다. green: `node --test --test-name-pattern=K382 tests/kit/documents.test.mts`가
  통과한다 (K382).
- `make hooks`는 kit의 commit-msg hook `.githooks/commit-msg`를 쓰고, 이 hook은 모든 commit에 `make commit`의 message
  검사(`make commit-msg-hook`, check-commits `--message`)를 실행하므로 AI 도구의 footer를 가진 amend를 포함해 `make
  commit` 밖에서 만든 commit은 만들 때 거부된다. hook이 없거나 바뀌면 `make hooks-check`가 실패한다. red: `make hooks`
  뒤 AI 도구의 `Co-Authored-By` trailer를 가진 amend가 성공했다. green: `node --test --test-name-pattern=K380
  tests/kit/git-hooks.test.mts`가 통과한다 (K380).
- `make test-php-ext`의 library run은 Composer가 library에 주는 vendor 디렉터리, 즉 library 자신의 것이나 path
  repository와 `vendor-dir`로 library를 설치하는 root project의 것에서 `run-tests`가 `phpunit --cwd`에 하듯이(K186)
  PHPUnit을 찾는다. red: `vendor-dir`을 가진 root project가 설치한 library가 `packages/php/vendor/phpunit/phpunit/phpunit
  does not exist`로 실패했다. green: `node --test --test-name-pattern=K367 tests/kit/run-tests.test.mts`가 통과한다
  (K367).
- `make link-state-check`는 `.php-version`보다 새 PHP를 요구하는 linked vendor의 platform check를 보고하고, package의
  더 낮은 floor를 요구하는 vendor는 보고하지 않는다. Composer는 package가 요구하는 가장 높은 floor(`>=8.4`이면 80400)를
  요구하기 때문이다. red: `.php-version` 8.4.1에서 80400을 요구하는 vendor가 finding이었다. green: `node --test
  --test-name-pattern=K384 tests/kit/link-state-check.test.mts`가 통과한다 (K384).
- `make dependency-review`는 lock된 version보다 오래된 version을 제안하지 않는다. registry의 최신 release가 lock된
  version보다 오래된 의존성, 예컨대 `0.0.6`에 대한 미출시 `0.0.11`은 linked 여부와 상관없이 outdated가 아니며 update
  plan에 들어가지 않는다. red: review가 `polyspec/template 0.0.11 < 0.0.6`을 제안하고 `composer require ...:^0.0.6`을
  계획했다. green: `node --test --test-name-pattern=K369 tests/kit/dependency-review.test.mts`가 통과한다 (K369).
- `make link-check`는 `CHECKOUTS`가 비면 `make link`처럼 저장소 옆의 checkout으로 검사하므로 `make link` 직후 모든
  link를 NOT linked로 보고하지 않는다. red: 그 명령이 checkout을 하나도 넘기지 않았다. green: `node --test
  --test-name-pattern=K383 tests/kit/kit-mk.test.mts`가 통과한다 (K383).
- `make install-packages`는 `npm ci`만 실행하고, `make install`은 link에 전체 install-tools만 설치하는 Go가 필요하므로
  전체 `make install-tools` 뒤 마지막 kit 단계인 `make install-link`로 link한다. bootstrap의 message는 그 순서를 말한다.
  red: 문서의 순서가 `npm ci` 뒤 link에서 실패했고 recipe가 install-packages 안에서 link했다. green: `node --test
  --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360-1).
- `make dependency-review`는 link가 `go.mod` 옆에 쓴 `go.work`로 Go module을 scan하므로 govulncheck가 code가 쓰는
  linked module을 compile하고, version 목록은 released module(`GOWORK=off`)에 머문다. 실패한 Go scan은 advisory
  database의 장애가 아니라 그 출력과 원인을 고치는 방법으로 보고된다. red: linked module의 scan이 `go.work` 없이
  실행되었다. green: `node --test --test-name-pattern=K365 tests/kit/dependency-go.test.mts`가 통과한다 (K365).
- `make item-new`, `make item-edit`, `make docs-check`는 따옴표 밖의 pipe를 가진 Verification 명령을 거부한다.
  pipeline은 첫 명령의 exit status를 숨기기 때문이다. `-run 'A|B'`처럼 따옴표 안의 pattern은 계속 허용된다. red:
  item-edit이 pipeline으로 실행되는 `go test -run A|B ./...`를 받았다. green: `node --test --test-name-pattern=K376
  tests/kit/plan.test.mts`가 통과한다 (K376).
- `make link-state-check`는 checkout의 install directory(`node_modules`, `vendor`, `.venv`, `target`, `var`)가 symbolic
  link이거나 `node_modules` 안의 workspace package link가 checkout 밖으로 resolve되면 실패한다. 그것들을 main
  checkout에 link한 worktree는 main checkout의 source를 실행하기 때문이다. polyspec provider로의 link는 계속 허용된다.
  red: `node_modules`를 link한 checkout이 통과했다. green: `node --test --test-name-pattern=K375
  tests/kit/link-state-check.test.mts`가 통과한다 (K375).
- `make lint-php`는 phpstan을 제한 없음을 뜻하는 phpstan의 값 `--memory-limit=-1`로 실행한다. 분석에 필요한 memory는
  package와 함께 커지고 제한은 분석을 멈출 뿐이기 때문이다. red: phpstan이 orm packages/php에서 php.ini의 128M에서
  멈췄고 명령에 memory 제한 option이 없었다. green: `node --test --test-name-pattern=K346 tests/kit/lint-php.test.mts`가
  통과한다 (K346).
- kit의 isolation test는 다른 저장소의 이름을 그 저장소를 가리키는 곳, 즉 package(`polyspec/<name>`,
  `@polyspec/<name>`, `github.com/polyspec/<name>`)나 경로 segment(`../<name>/`)에서만 읽으므로 link test의 변수
  `template` 같은 같은 영어 단어는 finding이 아니다. red: 그 변수 때문에 kit main에서 test가 실패했다. green: `node
  --test tests/kit/isolation.test.mts`가 통과한다 (K361).
- `make test-markers-check`는 하나의 규약을 따르는 fixture, 즉 `fixtures`나 `testdata` 폴더 안의 파일이나
  `*_fixture_test.go`, `*.fixture.test.*`, `test_*_fixture.py`, `*FixtureTest.php`라는 이름의 파일의 skip을 finding으로
  보지 않는다. 그런 fixture의 skip은 그 test가 검사하는 동작이기 때문이다. 그 밖의 skip과 fixture의 다른 marker는
  계속 finding이다. red: `*_fixture_test.go` 파일의 TestFixtureSkip이 finding이었다. green: `node --test
  --test-name-pattern=K344 tests/kit/test-markers.test.mts`가 통과한다 (K344).
- consumer의 `make install-packages`는 옆의 kit checkout의 link(`../kit/dist/link.mjs`)를 실행하고, `npm ci`가 방금
  설치한 released kit에는 `--siblings`가 없으므로 그 checkout이 build되지 않았으면 `npm ci` 전에 해결 방법과 함께
  실패한다. CI처럼 sibling kit이 없으면 설치된 kit의 link를 실행한다. K205 test는 K349가 사실로 만든 대로 recipe가
  설치 직후 link하고 build하지 않는다고 말한다. red: kit checkout 옆에서 recipe가 설치된 kit의 link를 실행했고 K205
  test가 실패했다. green: `node --test --test-name-pattern='K360|K205' tests/kit/link.test.mts`가 통과한다 (K360).
- plan utility는 home directory 안의 경로를 더하는 checklist를 docs-check의 private-path 함수로 거부하고, `make
  item-edit ID= TASK= TASK_KO=`는 done row를 포함해 row의 Task cell을 두 언어로 바꾼다. kit의 docs-check를 실패시킨
  home 경로 없이 row K358과 K363을 다시 썼다. red: item-new가 row에 home directory 안의 경로를 썼고 item-edit은 TASK를
  받지 않았다. green: `node --test --test-name-pattern=K373 tests/kit/plan.test.mts`가 통과하고 kit의 docs-check가
  통과한다 (K373).
- `make item-new`, `make item-edit`, `make item-state`, `make plan-split`은 자신이 바꾸는 한국어 문서가 최신이었으면
  새 영어 text의 revision marker를 쓰고, 낡은 문서는 낡은 채로 두므로 출력이 `make documents-stamp` 없이 docs-check를
  통과한다. red: item-new 뒤 marker가 바뀌기 전 text를 가리켰다. green: `node --test --test-name-pattern=K368
  tests/kit/plan.test.mts`가 통과한다 (K368).
- `make hooks`와 `make hooks-check`는 저장소에 `config/generated.json`이 없으면 그 파일을 말하며 실패한다. 이들이
  설치하는 pre-commit hook이 그 파일로 generated-file 검사를 실행해 모든 commit을 거부하기 때문이다. red: 파일 없이도
  check가 통과했다. green: `node --test --test-name-pattern=K362 tests/kit/git-hooks.test.mts`가 통과한다 (K362).
- `config/layout.kit.yml`은 kit-sync가 모든 저장소에 쓰는 `clippy.toml`을 root 파일로 선언하고, `kit.copies`의 root
  파일이 그 목록에 없으면 kit test가 실패한다. red: `clippy.toml`이 선언되지 않아 fsm에서 `make layout-check`가
  실패했다. green: `node --test --test-name-pattern=K356 tests/kit/kit-sync.test.mts`가 통과한다 (K356).
- kit-check는 다른 언어의 lint처럼 Rust source가 있는 저장소에서만 `CHECK_TARGETS`에 `lint-rust`를 요구한다. red:
  `.rs` 파일이 없는 저장소가 `CHECK_TARGETS`가 `lint-rust`를 실행하지 않는다는 finding을 받았다. green: `node --test
  --test-name-pattern=K364 tests/kit/kit-check.test.mts`가 통과한다 (K364).
- `link --siblings`는 origin이 `github.com/polyspec/<folder>`인 polyspec 저장소의 main checkout만 받고, `.git`을 가진
  그 밖의 폴더는 이유와 함께 skipped로 한 번 출력하므로 `template_2026` 같은 사본이 package를 한 번 더 제공하지 않는다.
  red: 사본 `prov_2026`과 `prov-copy`가 checkout으로 받아들여졌다. green: `node --test --test-name-pattern=K363
  tests/kit/link.test.mts`가 통과한다 (K363).
- `make item-state`, check-commits, `make bypass-check`는 kit-gates의 gate를 저장소 Makefile의 make database, 즉
  저장소가 쓰는 kit의 kit.mk를 include한 database에서 읽고, Makefile이 kit-gates를 선언하지 않으면 kit-gates를 말하며
  실패한다. 이전에는 kit만 가진 `scripts/kit/kit.mk`를 읽어 consumer에 gate가 없었으므로 Red-Gate 기록이 쓰이지 않았고
  `make -o <gate>`가 bypass-check를 통과했다. red: consumer layout에서 기록이 쓰이지 않았고 심어 둔 `make -o lint-go`가
  통과했다. green: `node --test --test-name-pattern=K357 tests/kit/plan.test.mts tests/kit/bypass-check.test.mts`가
  4개 중 4개 통과하고 fsm은 24개 gate를 읽는다 (K357-1).
- Composer project가 linked인 동안 link lock이 checkout의 절대 폴더를 가진 path dist로 기록한 provider는 저장소의
  path package가 아니라 review record와 비교되고 link로 판단되는(K328) linked 의존성이다. 상대 url의 path dist만
  저장소의 package이다. red: fsm에서 `make link` 뒤처럼 `make dependency-policy-check`가
  `packages/fixture-php/<절대 폴더>/composer.json is missing`으로 실패했다. green: `node --test
  --test-name-pattern=K358 tests/kit/dependency-policy.test.mts`가 통과한다 (K358).
- 결함이 lint finding 같은 kit-gates gate의 finding인 fix commit은 test 파일 대신 parent에서 그 gate의 red로
  증명된다. `make item-state`는 row가 `docs/plans` 밖에서 HEAD와 같은 tree에서 active가 될 때 Verification의 gate
  명령을 실행해 exit status를 `var/plan/<id>.json`에 기록하고, `make commit`은 실패한 gate마다
  `Red-Gate: make <gate> exit <n> at <parent>` 줄을 쓰며, check-commits는 commit이 item을 done으로 옮기고 그 줄이
  row의 gate와 parent를 가리킬 때 commit을 받아들인다. red: 그런 commit은 commit-fix-test로 거부되었고 red는 기록되지
  않았다. green: `node --test --test-name-pattern=K357 tests/kit/plan.test.mts`가 2개 중 2개 통과한다 (K357).
- Claude Code hook, `make item-test`, `make item-state`는 `run-tests.mts` 명령을 runner와 같은 방식으로 읽는다. option 뒤의
  인수는 `--` 없이도 받고 파일은 `--cwd`에서 해석하므로 `--cwd packages/php -- ../../tests/XTest.php`가 허용된다.
  item-test와 item-state는 Verification 명령의 파일을 명령을 실행하는 root에서 판단한다. red: 두 명령 모두 hook이
  거부했다. green: `node --test --test-name-pattern=K353-2 tests/kit/claude-hook.test.mts tests/kit/plan.test.mts`가
  2개 중 2개 통과한다 (K353-2).
- `make dependency-policy-check`는 `make dependency-review`처럼 `GOWORK=off`로 실행되므로, linked Go checkout이 어떤 manifest도
  선언하지 않는 lock의 review record를 더 이상 보고하지 않는다 (K343).
- `make lint-ts`, `make commit`, `make item-test`의 type 검사는 package의 `package.json`에 `typecheck` script가 있으면
  그것(`.svelte` 파일이 있는 package는 svelte-check)을 실행하고, 없을 때만 `tsc --noEmit`을 실행한다 (K355).
- Composer project가 linked인 동안 의존성 review와 policy는 locked version을 `composer.link.lock`에서 읽으므로, review record는 relock할
  수 없는 tracked lock이 아니라 Composer가 resolve하고 vendor가 가진 것과 비교된다 (K326-1).
- `make install-packages`는 설치한 패키지를 저장소 옆의 polyspec checkout에 링크하고(`link --siblings`), `CHECKOUTS` 없는 `make link`는
  worktree에서도 그 checkout을 쓰며, `make link-state-check`는 lock에서 설치한 뒤 link 단계가 없는 recipe와 `.php-version`과 다른 PHP를 요구하는
  linked vendor를 실패시킨다 (K349).
- `make item-state`는 verification을 실행하기 전에 done으로의 transition을 검사하므로, waiting row는 stage하지 않은 파일이 아니라 이동할 수 있는 상태와 함께
  거부된다 (K353-1).
- `make item-edit ID= VERIFICATION=`는 `item-new`와 같은 검사를 거쳐 두 언어 row의 Verification 칸을 바꾸고, `make item-state`와 `make
  item-test`의 type 검사는 tsc가 찾지 못하는 workspace package를 build(`npm run build`)한 뒤 다시 compile한다 (K353).
- `make lint-rust`는 P8 은폐도 실패시킨다: `let_underscore_untyped`, `map_err_ignore`, 명시적 `unused_must_use`, `allow_attributes_without_reason`, 그리고 kit이 복사하는 `clippy.toml`은 `#[allow]`가 reason을 밝히지 않는 한 `Result::ok`, `unwrap_or`, `unwrap_or_default`, `unwrap_or_else`를 금지한다. `lint-rust`는 `kit-gates`와 kit의 CI에 들어가므로 P8이 이를 명시한다. Red: type 없는 `let _`와 금지 method가 통과했다. green: 각각 해당 lint로 실패하고 reason을 밝힌 variant는 통과한다 (`tests/source/lint-rust-real.test.mts`) (K334).
- `make parity-declarations-check`는 root에 ecosystem의 manifest(`package.json`, `composer.json`, `pyproject.toml`,
  `go.mod`, `Cargo.toml`)가 없는 `config/parity.json`의 implementation과 다른 implementation의 root를 그대로 가진 implementation을
  실패시킨다. implementation은 source root이지 test glob만이 아니기 때문이다 (K336).
- `make lint-go`는 P8 은폐도 실패시킨다: `check-blank`와 `check-type-assertions`를 켠 errcheck(`_`에 대입한 error, 확인하지 않은 assertion), nilerr, errorlint, nolintlint(`//nolint`는 linter와 reason이 필요하다). Red: 심은 pattern 7개가 통과했다. green: 각각 해당 linter로 실패하고 need를 밝힌 variant는 통과한다 (`tests/source/lint-go-real.test.mts`). symbol extractor `symbols/go/main.go`는 marshal error를 보고한다 (K334).
- `make item-state`는 item의 Verification 칸의 명령이 commit이 담는 tree에서 통과한 뒤에만 done으로 표시한다. 산출 파일은 stage되었거나 commit되어 있어야
  하고, 실패한 명령은 그 상태를 거부한다 (K335).
- 의존성 policy는 일반 Composer release를 version으로 비교하므로, registry의 latest release보다 높은 locked version(예: 0.0.6에 대한 미공개
  `polyspec/template 0.0.11`)은 outdated가 아니다 (K328-1).
- `make lint-python`은 P8 은폐도 실패시킨다: SIM105, typed `try`-`except`-`pass`와 `continue`(`check-typed-exception`의 S110, S112), TRY201, TRY203, TRY400, B012, 규칙 없는 `type: ignore`(PGH003)와 `noqa`(PGH004), 아무것도 억제하지 않는 `noqa`(RUF100). Red: 심은 각 pattern이 lint를 통과했다. green: 각각 해당 rule로 실패하고 need를 밝힌 variant는 통과한다 (`tests/source/lint-python-real.test.mts`) (K334).
- Parity 규칙 R16은 internal test의 모든 match 중 `docs/spec`이 정의한 requirement pattern의 match만 보고하므로, `UTF-8`과 `SHA-256`은
  requirement를 이름으로 부르지 않는다 (K342).
- Composer project가 linked인 동안 `make dependency-review`는 `composer.link.json`과 그 lock으로 Composer를 실행하고, linked
  package를 registry와 비교하거나 update하지 않으며, tracked `composer.json`과 `composer.lock`을 바꾸지 않는다 (K340).
- link와 parity test는 시간이 제한되고 더 싸다. `tests/kit/link.test.mts`의 모든 case는 60초 timeout을 갖고, sandbox repository는 git
  process 6개 대신 설정된 `.git` 폴더 하나의 복사이며, link workspace는 process당 한 번 commit한 repository 세 개를 복사한다 (K301).
- Parity 규칙 R17(leaked-internal)은 internal symbol을 이름으로 가리키는 public signature, parent class, interface를 finding으로 한다.
  대상은 `@internal` PHP class, `_`로 시작하는 private Python 이름, entry point가 export하지 않는 TypeScript type(API Extractor
  `ae-forgotten-export`)이다 (K307-1).
- Parity 규칙 R10은 구현의 개수를 말하는 문구만 센다. 복합 명사의 수식어("one language service")와 비교의 쌍("between the two languages")은 개수로 보지
  않는다 (K311).
- `make duplication-check`는 `config/duplication.json`의 exclude glob을 설정 파일로 jscpd에 넘기므로, `{tests,spec}/**` 같은 중괄호
  glob은 중괄호를 유지하고 그 이름의 파일을 제외한다 (K310).
- kit에서 `make lint-ts`가 통과한다. link, divergence check, PHP library autoload의 test와 tool은 JSON을 schema나 guard로 읽고,
  real-tool test의 `php` binary는 `config/knip-entries.json`에 선언한다 (K333).
- `make lint-ts`는 TypeScript가 있는 각 `tsconfig.json`의 폴더에서 `tsc --noEmit -p tsconfig.json`을 실행하고, vitest와 node는 type 검사
  없이 transpile하므로 `make commit`과 `make item-test`는 변경된 각 TypeScript 파일이 속한 `tsconfig.json`으로 이를 실행해 type error면 거부한다
  (K309).
- `kit link`는 install recipe의 uv sync가 editable을 제거한 뒤처럼 환경에 없는 선언된 polyspec Python package를 provider 폴더의 editable
  install로 설치하므로, 두 번째 실행도 첫 번째처럼 linked로 끝난다 (K316-2).
- Parity 규칙 R6은 bound 파일처럼 어느 구현의 `internal` glob이 고르는 test 파일도 제외하므로, PHP 구현의 internal node 실행 test는 R6에 걸리지 않는다
  (K332).
- `kit link`는 linked package의 partial `composer update`를 `--with-dependencies`로 실행하므로, linked package가 새 constraint로
  요구하는 dependency는 resolve되고 관계없는 package는 locked release에 남는다 (K331).
- Composer는 `repositories`를 root manifest에서만 읽으므로, `make dependency-policy-check`는 polyspec package를 require하는 root
  `composer.json`에 그 package의 `composer.json`이 선언한 repository가 없으면 package와 repository 이름과 함께 실패하고, `kit link`는 linked
  package가 선언한 repositories를 `composer.link.json`에 쓴다 (K330).
- `make test-php-ext`의 extension 실행은 library의 PHPUnit 파일을 load하고 library의 source는 하나도 load하지 않는다(K329) in S10: `run-tests phpunit --without-library <폴더>`가 library의 vendor directory 위에 Composer가 dump한, library의 dependency와 autoload-dev는 담고 library 자신의 autoload는 담지 않는 autoloader로 PHPUnit script를 시작하며, library의 source를 include하는 test는 실행을 실패시킨다. `make divergence-check`는 Git이 무시하는 구현 root 아래의 source도 읽고 `function_exists`를 `extension_loaded`처럼 보고하므로 library에는 extension에 대한 guard가 없다. Red: `node --test tests/source/php-library-real.test.mts`에서 library autoload로 library의 source가 load되었다. Green: 하나도 load되지 않고 require한 source는 실행을 실패시킨다.
- 연결된 패키지(Composer project의 link lock의 path dist, `node_modules`의 심볼릭 링크)는 `make dependency-review`와 `make dependency-policy-check`에서 registry의 최신 release와 비교하지 않고 외부 패키지는 여전히 비교한다(K328). 개발 중에는 local checkout이 canonical이므로 그 패키지는 link로 판단하고 registry 비교는 일괄 release의 검사에 속한다. Red: `node --test --test-name-pattern=K328 tests/kit/dependency-policy.test.mts`가 연결된 패키지에 `psr/log: 3.0.2 is older than 99.0.0`으로 실패했다. Green: 통과하고 외부 패키지는 여전히 보고된다.
- 저장소는 `mise.toml`에 http backend로 내려받는 자기 도구를 선언할 수 있다(K327). key는 `http:<이름>`이고 정확한 `version`과 https `url`을 가진 table이다. `mise.lock`이 모든 platform의 sha256을 pin하고 `make toolchain-check`가 sha256이 빠진 platform을 이름으로 알린다. kit이 검사하지 않는 다른 backend의 도구는 여전히 거부한다. Red: `node --test --test-name-pattern=K327 tests/kit/toolchain-mise.test.mts`가 `mise.toml tools declares http:pie, which kit does not check`로 거부되었다. Green: 통과한다.
- `make divergence-check`(K315)는 모든 저장소의 gate이다. extension, runtime, platform으로 분기하는 test, 다른 구현이 있는지 읽는 구현의 code, `--exclude-group`, `contracts/features.json`의 `partial`이나 `unsupported`, reason이 kit이 정한 kind(`generated:`, `fixture:`, `test:`, `harness:`, `ecosystem:`, `external:`)로 시작하지 않는 `config/duplication.json`의 예외와 `config/parity.json`의 `tools`, `internal`에 실패한다. `make test-markers-check`는 `testing.Short()`, `pytest.importorskip`, `@requires`, `#[Requires...]`, `node:test` context의 skip도 읽고, `make item-state`는 cause가 release, 재현되지 않음, flake, 일시적이거나 무관한 실패, 환경을 인용하는 bypassed나 impossible 상태를 거부한다. 2026-10-21의 finding: orm 101(test 분기 68, partial feature 18, 예외 11, code 분기 4), template 12, crudui 44, hyper 10, fsm 5, ordered-json 4, ssr 5. Red: 검사가 없었다(case가 `divergenceFindings`를 import한다). Green: `node --test tests/kit/divergence-check.test.mts`가 각 kind를 찾는다.
- provider 폴더의 non-editable 설치나 릴리스 wheel 위의 link는 editable install이 된다(K316-1): 설치의 overrides 파일은 연결된 package마다 `-e <폴더>` 줄 하나를 담는다. `name @ file://<폴더>` 줄은 uv가 non-editable 요구로 보게 해서 명령줄의 `-e`보다 우선하고 package를 non-editable로 남겼기 때문이다(이 checkout의 uv로 확인: URL 줄이면 `dir_info`가 비고 `-e` 줄이면 `{"editable":true}`이며, 다른 package를 릴리스 URL로 요구하는 package도 마찬가지이다). registry나 archive 설치의 메시지는 그렇게 말한다. Red: `node --test --test-name-pattern=K316-1 tests/kit/link.test.mts`가 `name @ file://` 줄을 찾았다. Green: `-e` 줄을 찾는다.
- linked 패키지의 `composer.link.json` path repository는 `symlink`와, lock이 기록한 릴리스(없으면 project가 요구하는 정확한 릴리스)로 정한 `versions`를 가지고 다른 repository보다 앞에 오므로, Composer가 그 릴리스를 폴더로 취하고 같은 version의 archive를 택하지 않는다(K304-2). orm, hyper(root와 `examples/board`), crudui의 link lock은 연결된 모든 polyspec 패키지를 dist type `path`로 가지며 `platform_check.php`가 폴더에서 나온 PHP 8.4.1 또는 8.4.0이다. Red: lock에 없는 패키지는 `versions`를 받지 못했다. Green: `node --test --test-name-pattern=K304-2 tests/kit/link.test.mts`가 통과한다.
- Composer project가 link된 동안(`composer.link.lock`이 있는 동안) `make dependency-policy-check`는 그 project의 platform과 `composer validate`를 `composer.link.json`과 `composer.link.lock`에서 판단하고, link manifest의 path repository의 패키지를 link lock이 다른 dist로 가지면 실패시키며, 추적되는 lock의 review hash는 일괄 release의 검사에 맡긴다(K326). Red: `node --test --test-name-pattern=K326 tests/kit/dependency-policy.test.mts`가 PHP 8.5.0으로 resolve된 추적되는 lock에서 실패했다. Green: link lock에서는 통과하고 다른 platform이나 dist의 link lock은 여전히 실패시킨다.
- `config/parity.json`의 구현은 이유를 단 `internal` glob을 선언한다(K313). 맞는 test는 parity unit이 아니므로 R5가 binding을 요구하지 않고 어떤 binding도 부를 수 없으며, spec의 requirement를 부르지 않으므로(R16) contract test가 거기 숨을 수 없고, test를 고르지 않는 glob은 선언을 실패시킨다. 기존 `tools`가 contract를 구현하지 않는 단일 언어 package를 이미 덮으므로 `outside` 선언은 더하지 않는다. Red: schema가 선언을 거부했고 R5가 internal 파일을 지적했다. Green: `node --test --test-name-pattern=K313 tests/kit/parity.test.mts`가 통과한다.
- conductor의 상시 결정은 kit의 규칙이다(K314): PRINCIPLES P32~P35가 범위(모든 구현의 contract 동작, 고유한 통합은 중립 규칙 하나, parity unit이 아닌 내부 test, `docs/spec`에 없는 규칙은 먼저 쓰기, unit을 버리지 않음, test 없이 인용하지 않음, 검사를 피하려는 이름 변경 금지, 반복된 code 재구성, 생성물 미추적)와 provider(release 때문에 막힌 finding은 link 결함)를 각각 `Enforced by`와 함께 적고, `docs/operations/adoption.md`가 item 경계의 절차와 물을 수 있는 질문을 적는다. Red: 결정이 message와 scratch 파일에 있었다. Green: `node scripts/kit/check-rules.mts`가 각 규칙을 그 검사와 함께 읽는다.
- `make bypass-check`(K308)는 모든 저장소의 gate이다. workflow 밖에서 CI identity(`GITHUB_ACTIONS`, `CI`)를 설정하거나, `make -o`, `--old-file`, `--assume-old`에 `kit-gates`의 gate를 적거나, `--no-verify`를 쓰는 추적되는 test, script, Makefile, Git hook에 실패하고, kit 자신의 도구와 test는 제외한다. Red: 검사가 없어서 `GITHUB_ACTIONS: 'true'`나 `make -o toolchain-check`를 가진 test가 모든 gate를 통과했다(case가 `bypassFindings`를 import한다). Green: `node --test tests/kit/bypass-check.test.mts`가 각각을 찾는다.
- `make rules-check`는 make target을 부른 변수 집합마다 한 번 펼치므로 workflow의 모든 `make ci-targets TARGETS=...` 호출에 닿고, 뒤의 호출의 target으로 강제되는 규칙이 어디서도 실행되지 않는다고 보고되지 않는다(K312). Red: `node --test --test-name-pattern=K312 tests/kit/check-rules.test.mts`가 `make second`를 닿지 않았다고 보고했다. Green: 아무것도 찾지 않는다.
- `make test-js`와 `make test-ts`는 package의 `*.test.*`와 `*.spec.*` 파일, 곧 node와 vitest 규약의 이름만 부르므로 `tests/` 아래의 probe나 helper는 test로 실행되지 않는다(K325). Red: `node --test --test-name-pattern=K325 tests/kit/runtime-targets.test.mts`가 `tests/probe.mjs`와 `tests/helper.mts`를 나열했다. Green: test 파일만 나열한다.
- `make test-python`은 package의 test를 그 package의 환경에서 실행한다. package 폴더 이하 위쪽의 가장 가까운 `.venv`를 `--venv`로 싣는다(K324). 그래서 package의 dependency가 import된다. Red: `node --test --test-name-pattern=K324 tests/kit/runtime-targets.test.mts`가 `--venv` option을 기대했는데 실행에 없었다. Green: 통과한다.
- kit이 쓰는 Composer project(`config/php-lint`, `config/phpunit`, symbol extractor)는 `composer.json`과 lock의 `platform-overrides`에서 `.php-version`의 minor에 patch 1을 붙인 PHP 8.4.1로 resolve한다(K322). Red: `node --test tests/kit/php-platform.test.mts`가 config/php-lint와 extractor project에서 `8.4`를 찾았다. Green: `8.4.1`을 찾는다.
- suite `CHECK_TARGETS`는 `suiteTargets`가 `$(VAR)` 단어를 펼쳐서 읽으며, `kit-check`의 gate 검사와 owner 검사가 이를 쓴다(K321). Red: `node --test --test-name-pattern=K321 tests/kit/kit-check.test.mts`가 `$(MORE)`가 `docs-check`를 담는데도 빠졌다고 보고했다. Green: 아무것도 찾지 않는다.
- `make link-state-check`는 kit이 쓰는 Composer project(`kit.copies`의 사본, `config/php-lint`, `config/phpunit`)를 제외하므로 그런 것만 가진 저장소는 Composer가 필요 없다(K320). Red: `node --test --test-name-pattern=K320 tests/kit/link-state-check.test.mts`가 없는 Composer 때문에 throw했다. Green: 아무것도 찾지 않는다.
- `make lint-php`와 `make lint-python`은 PHP나 Python source가 없는 저장소에서 통과한다. 도구나 설정을 찾기 전에 step이 비어 있다(K319). Red: 문서만 있는 tree에서 `node --test tests/kit/lint-php.test.mts tests/kit/lint-python.test.mts`가 없는 도구 때문에 throw했다. Green: 둘 다 step 없이 돌아온다.
- Composer 패키지는 폴더가 link이고 `installed.json`이 `dist` type `path`를 기록할 때만 linked로 센다(K318). 옛 mechanism이 남긴 릴리스 archive 설치 위의 link는 partial update가 다시 설치하고, 이미 link된 폴더도 같은 update에 남으며, `link-state-check`는 기록이 다른 dist type인 link를 실패시킨다. Red: 손으로 만든 link 아래 archive 설치가 있는 `tests/source/link-composer-real.test.mts`에서 archive가 유지되었다(기록 dist type `zip`). Green: 기록이 `path`이고 platform check가 폴더를 따른다.
- Python link는 provider 폴더의 editable install이다(K316): lock의 constraints와 연결된 각 패키지를 폴더의 URL로 지정하는 overrides 파일로 `uv pip install --reinstall-package <이름> -e <폴더>`를 실행한다. `var/link/wheels`에 wheel을 build하거나 보관하지 않고, 상태는 `direct_url.json`(폴더와 `dir_info.editable`)에서 읽으며, uv가 그 설치 시점에 `Requires-Python`과 요구사항을 검사한다. fingerprint, prebuilt wheel, read-only stale 경로는 제거했다. Red: link test가 `-e <폴더>` 설치를 기대했는데 `uv run`으로 build한 wheel이었다. Green: 통과하며 이 checkout의 실제 uv가 다른 연결된 패키지를 릴리스 URL로 요구하는 패키지를 `-e`와 override로 설치한다.
- Composer link는 Composer가 스스로 설치하는 `symlink` path repository이다(K304-1): link는 git이 무시하는 `composer.link.json`(추적되는 `composer.json`에 provider 폴더마다 path repository를 repositories 앞에 두고 lock의 릴리스를 version으로 쓴 것)과 lock의 사본을 쓰고 연결된 polyspec 패키지와 자기 path 패키지에 `COMPOSER=composer.link.json composer update`를 실행한다. 설치된 폴더는 심볼릭 링크이고 기록, autoload 규칙, platform check는 폴더의 `composer.json`에서 나오며, `composer.json`과 `composer.lock`은 그대로이고, `unlink`는 link 파일을 지운다. K304의 손으로 한 `installed.json` 수정은 제거했다. Red: link test가 `composer.link.json`을 쓰는 `composer update`를 기대했는데 `dump-autoload`였다. Green: 통과하며 `tests/source/link-composer-real.test.mts`가 실제 Composer로 archive가 PHP 99를 요구하는 패키지를 폴더에서 설치한다.
- `make link-state-check`가 `link-metadata-check`를 대체한다(K305-1): link는 설치된 릴리스 버전으로 간주되므로 version도 요구사항도 비교하지 않으며, link가 있는 동안 link들 사이의 사본인 설치된 0.0.x polyspec package, 그 이름의 package로 풀리지 않는 link, `go.mod` 없는 `go.work`의 `use` 폴더에 대해 package를 적어 실패한다. PRINCIPLES P30과 local-links가 owner 규칙을 적는다. Red: `tests/kit/link-state-check.test.mts`가 없는 module을 import했고 낡은 기록이 옛 gate를 실패시켰다. Green: 통과한다.
- PHP symbol extractor는 docblock에 `@internal`을 가진 class, function, constant, method, property를 public API로 보지 않으며(phpstan과 psalm의 의미), 그 tag를 가진 class는 member를 숨긴다(K307). Red: `node --test tests/source/symbols-php-real.test.mts`가 `A\\Hidden`, `A\\Open::secret` 등 internal symbol을 나열했다. Green: public인 것만 나열한다.
- `parity.mts`는 extractor와 runner를 `toolsEnvironment(root)`로 실행하므로, mise shim이 consumer에서 "mise.toml not trusted"로 실패하지 않고 checkout의 mise 환경을 찾는다(K306). Red: `MISE_GLOBAL_CONFIG_FILE`이 필요한 python shim으로 `node --test --test-name-pattern=K306 tests/kit/parity.test.mts`가 실패했다. Green: 통과한다.
- `make link-metadata-check`(K305)는 모든 저장소의 gate이다. link가 있는 동안 연결된 npm 패키지가 그 이름의 패키지로 풀리지 않거나, installed.json의 Composer 기록이 install-path의 composer.json과 다르거나, editable Python 설치의 Version 또는 Requires-Python이 pyproject.toml과 다르거나, go.work의 use 폴더에 go.mod가 없으면 패키지와 field를 적어 실패하고, link가 없는 checkout은 통과한다. Red: gate가 없어서 hyper의 낡은 기록이 모든 gate를 통과했다(case가 `linkFindings`를 import한다). Green: `node --test tests/kit/link-check.test.mts`가 통과하고 gate가 `hyper/examples/board`의 낡은 기록을 보고한다.
- Composer link는 `composer dump-autoload` 전에, 링크된 package와 프로젝트의 path package에 대해 연결된 source의 composer.json의 `require`, `autoload`, `replace`, `provide`, `conflict`, `version`을 installed.json에 가져오므로 platform check와 autoload 규칙이 source 그대로를 따른다(K304). Red: `node --test --test-name-pattern=K304 tests/kit/link.test.mts`에서 기록이 릴리스된 `php >=8.5`를 그대로 요구했다. Green: source의 `>=8.4`를 기록한다.
- `make toolchain-check`는 `packages/php-ext`가 있는 저장소에서 `make php-ext-arginfo`가 필요로 하는 system 명령을 알린다: PHP의 gen_stub.php가 PHP-Parser를 내려받고 풀 때 쓰는 `curl` 또는 `wget`과 `tar`이다(K303). 고정된 Composer PHP-Parser는 택하지 않았다. gen_stub.php가 자기 PHP에 맞는 release를 하나로 정하기 때문이다. Red: 빠져 있어도 toolchain-check가 조용했다(case가 없던 `arginfoToolFindings`를 import한다). Green: `node --test --test-name-pattern=K303 tests/kit/check-toolchain.test.mts`가 통과한다.
- `make build-php-ext`와 `make php-ext-arginfo`의 build 사본은 extension의 source(stub, config.h를 뺀 C와 header 파일, config.m4, config.w32, src/ 옆의 composer.json)만 담고 build folder나 산출물은 담지 않으므로, 무시된 src/에 남은 낡은 object나 module이 build되거나 게시될 수 없다(K302). Red: `node --test --test-name-pattern=K302 tests/kit/php-ext.test.mts`가 C가 compile되지 않는데도 extension을 built로 보고했다. Green: build가 실패하고 아무것도 게시하지 않는다.
- `make rules-check`는 AGENTS.md를 구조로 읽는다(K300): PRINCIPLES.md의 각 규칙에는 id(P<n>, S<n>)가 있고, AGENTS.md의 각 규칙은 `Own:` 또는 `Refines <id>:`로 시작하며, 다듬는 규칙은 PRINCIPLES.md에 없는 기존 경로나 make target을 backtick으로 적는다. K279의 4단어 유사도는 제거했다. kit의 AGENTS.md와 한국어 쌍이 이를 따른다. Red: `node --test --test-name-pattern=K300 tests/kit/check-rules.test.mts`에서 짧은 되풀이 "Build modular components"에 finding이 없었다. Green: 통과한다.
- spec의 requirement는 `**<id>**`로 시작하는 list item, 곧 글머리 기호(`-`, `*`, `+`)나 번호(`1.`, `1)`) 항목, 또는 heading으로 정의한다(K299). S6과 schema는 list item이라고 적는다. Red: `node --test --test-name-pattern=K299 tests/kit/parity-requirements.test.mts`가 `1. **AB-4**`에 R13을 찾지 못했다. Green: 통과한다.
- `make test-python`은 `test_*.py`를 담고 `__init__.py`가 없는 Python package의 test directory를 더할 파일을 적어 거부한다. unittest는 directory를 package로만 discover하므로 그렇지 않으면 아무 test도 실행하지 않았다("no test ran")(K298). orm, template, crudui, hyper는 이미 test directory를 package로 만들었고 ordered-json이 파일을 더한다. Red: 바뀌지 않은 runner가 실행을 돌려주어 `node --test --test-name-pattern=K298 tests/kit/runtime-targets.test.mts`가 실패했다. Green: 통과한다.
- S10은 PHP library가 둘 이상인 저장소에도 성립한다(K293): extension 하나가 모든 library를 구현하며, library는 `polyspec/<repository>`라는 이름의 `packages/php`이거나 `polyspec/<repository>-<component>`라는 이름의 `packages/<component>/php`이다. `make lint-php-ext`가 그 이름을 확인하고, `make test-php-ext`가 등록한 이름마다 그것을 선언한 library와 비교하며 모든 library의 PHPUnit 파일을 실행하고, parity extension이 모든 library의 implementation을 공유한다. Red: `packages/php` 하나를 가정해서 `tests/kit/php-ext.test.mts`, `runtime-targets.test.mts`, `parity.test.mts`의 K293 case가 실패했다. Green: 통과한다.
- `make plan-split FROM= TO= IDS=`는 item의 행을 sub-item과 함께 text를 바꾸지 않고 한 plan의 checklist에서 다른 plan의 checklist로, 한국어 쌍에서도 옮기고, 대상 plan이 없으면 만들며, 거부하면 아무것도 쓰지 않는다(K292). Red: `splitPlan`이 없어서 `node --test tests/kit/plan.test.mts`가 실패했다. Green: 통과한다.
- `make lint-php-ext`, `make build-php-ext`, `make php-ext-arginfo`는 tracked 파일과 함께 disk의 `packages/php-ext` 파일을 읽으므로, `src/`를 생성하고 Git이 무시하는 extension도 tracked와 똑같이 통과한다(K297). Red: `node --test --test-name-pattern=K297 tests/kit/php-ext.test.mts`가 `the stub of the extension is missing`으로 실패했다. Green: 통과한다.
- 문서는 존재하는 규칙을 적는다(K291): local-links는 모든 개발이 끝나기 전에는 kit을 포함해 어떤 저장소에서도 릴리스, tag, 버전 올림을 하지 않으며 push는 아무것도 게시하지 않는다고 적고, tool-inventory의 language parity 절은 S6이 선언에서 없앤 profile, admit 목록, exclusion(R8), nativeOnly 항목, spec anchor를 더는 기술하지 않는다. Red: 본문이 이들을 기술했다. Green: `node scripts/kit/check-documents.mts`가 통과하고 절이 `parity.schema.json`을 따른다.
- pyproject의 dependency array에 `[build-system] requires`가 포함되므로 `make dependency-review UPDATE=1`이 setuptools 같은 build requirement를 project의 것처럼 pin한다(K296). Red: `node --test --test-name-pattern=K296 tests/kit/pin-python-dependency.test.mts`가 setuptools의 exact pin이 없다며 실패했다. Green: 통과한다.
- `make build-php-ext`와 `make php-ext-arginfo`는 `composer.json`을 `src/` 옆에 둔 사본에서 작업하므로 `config.m4`가 version의 유일한 source인 `../composer.json`에서 package version을 읽는다(K295) in S10. Red: `node --test tests/kit/php-ext.test.mts`가 build한 fixture의 `phpversion()`이 composer.json의 1.2.3이 아니라 비어 있어 실패했다. Green: 통과한다.
- `make php-ext-arginfo`는 header의 규칙이 configure가 쓰는 Makefile에 있으므로 header를 만들기 전에 사본에서 ./configure를 실행한다(K290). Red: `node --test --test-name-pattern=K290 tests/kit/php-ext.test.mts`가 `make: *** No rule to make target polyspec_demo_arginfo.h`로 실패했다. Green: 통과한다.
- `make rebuild-check`는 consumer 자신의 package.json에는 없는 kit.copies가 아니라 설치된 kit(`node_modules/@polyspec/kit/package.json`의 kit.copies, kit-check가 읽는 것과 같다)가 나열하는 vendored 사본을 제외한다(K294). Red: `node --test --test-name-pattern=K294 tests/kit/rebuild-check.test.mts`가 사본을 tool source로 나열해 실패했다. Green: 통과한다.
- `make dependency-policy-check`는 PHP platform을 하나로 요구한다(K282): composerPlatforms의 모든 항목과 Composer manifest의 모든 config.platform.php가 같은 PHP를 가리키고, .php-version이 있으면 그 minor에 PHPUnit 13이 요구하는 patch 1을 붙인 값(8.4.1)이다. Red: 검사를 되돌린 상태에서 `node --test --test-name-pattern=K282 tests/kit/dependency-policy.test.mts`가 실패했다(platform finding 없음). Green: 통과한다. hyper, fsm, orm, template(8.4.0)은 이제 이 규칙에 실패한다.
- version이 아닌 Composer 응답은 version으로 기록하지 않는다(K281): `version.mts`의 `isVersionText`가 composer outdated의 "[none matched]"를 거부하므로 dependency-review는 release 없음으로 보고하고 dependency-policy-check는 latest가 version이 아닌 review 기록을 실패시킨다. Red: dependency-review와 dependency-policy test의 `--test-name-pattern=K281`이 실패했다(sentinel이 기록되고 받아들여졌다). Green: 둘 다 통과한다.
- `make rules-check`는 PRINCIPLES 규칙을 되풀이한 AGENTS 규칙을 실패시킨다: 4단어 연속의 4분의 1을 넘는 부분이 PRINCIPLES.md의 한 규칙에 있는 경우이다(K279). 일곱 저장소의 AGENTS 규칙은 kit의 되풀이한 규칙(0.29, 0.71, 0.82)을 빼면 0.15 이하였고, kit의 사본 네 개를 제거했다. Red: `node --test --test-name-pattern=K279 tests/kit/check-rules.test.mts`가 되풀이한 규칙에 finding을 내지 않았다. Green: 통과하며 kit에서 `node scripts/kit/check-rules.mts`가 통과한다.
- `make kit-check`는 저장소의 CHECK_TARGETS가 kit-gates의 모든 prerequisite에 단어나 prerequisite로 닿을 것을 요구하며, 언어의 lint와 PHP extension gate는 그 code를 가진 저장소에서만 요구한다(K289). Red: suite를 읽는 check가 없어서 language-check, rebuild-check, duplication-check가 없는 저장소도 kit-check를 통과했다(case가 없던 `gateFindings`를 import한다). Green: `node --test tests/kit/kit-check.test.mts`가 통과하고 kit-check가 hyper, fsm, ordered-json, crudui에서 빠진 gate를 지목한다.
- `make duplication-check`는 jscpd 자체의 `--ignore-pattern`으로 logic이 없는 줄의 token을 건너뜁니다(K287): PHP의 declare, namespace, use, TypeScript와 JavaScript의 import(한 줄과 block), Go의 package와 import(단일과 block), Python의 import와 from-import, Rust의 use(단일과 중괄호), C의 #include. docblock, signature, mode, 최소 token 수는 그대로입니다. Red: `node --test --test-name-pattern=K287 tests/kit/duplication-check.test.mts`가 header만 같은 두 file이 보고되어(`1 !== 0`) 7개 case 모두 실패했습니다. Green: 7개 모두 통과하며 6줄 body가 같은 두 file은 여전히 실패합니다.
- kit의 typecheck가 통과한다(K288): `tests/kit/link.test.mts`의 두 assertion은 문자열 message를 넘기고 `tests/kit/parity-requirements.test.mts`는 `caseFile`을 주어졌을 때만 지정한다. Red: `npx tsc --noEmit -p .`가 link.test.mts(384,125)와 (387,134)의 TS2769, parity-requirements.test.mts(65,106)의 TS2375를 나열했다. Green: 출력이 없다.
- `make rebuild-check`는 저장소의 layout(`scripts/`, package의 `scripts|tools|bin`, generator, benchmark, example, fixture generator)으로 tool source를 찾고 `config/rebuild.json`은 분류만 한다: `paths`를 없앴으므로 저장소는 gate가 보는 범위를 좁힐 수 없다(K286). 좁은 `paths`가 가리던 `install-php.mts`와 PHP·Python symbol extractor의 class를 kit 자신의 config에 추가했다. Red: `node --test tests/kit/rebuild-check.test.mts`가 선언한 path 밖 tool의 case에서 실패했다(benchmarks/run.js와 packages/codec/tools/make.mjs가 통과). Green: 통과하며, `node scripts/kit/rebuild-check.mts`는 처음에 kit의 미분류 tool 다섯을 지목한 뒤 통과한다.
- PHP extension의 test는 `packages/php`의 PHPUnit 파일이다(K285), S10: `make test-php-ext`는 extension을 load해 `packages/php`(그리고 test가 있으면 `packages/php-ext`)를 실행하고, root `packages/php-ext`의 parity implementation은 layout에 따라 root `packages/php`의 implementation을 공유하므로, 저장소는 `config/parity.json`에 상대 경로(`../php/tests`)를 선언하지 않는다. Red: test 없는 fixture extension에 `node --test tests/kit/runtime-targets.test.mts`가 `cwd: 'packages/php-ext'`로 실패했고, `node --test --test-name-pattern=K285 tests/kit/parity.test.mts`가 `php-ext`의 R6을 찾았다. Green: 둘 다 통과한다.
- var/tools의 Composer project 설치(PHPUnit, PHP lint)는 최신일 때만 유지한다: 설치의 composer.lock이 project의 lock과 byte 단위로 같고 Composer 자체의 `composer check-platform-reqs --lock`이 wrapped PHP 아래에서 통과해야 하며, 아니면 `make install-tools`가 다시 설치한다. 그래서 PHP 8.5로 만든 설치가 PHP 8.4에서 `Composer dependencies require a PHP version >= 8.5.0`으로 실패하지 않는다. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-composer-project.test.mts` 0 passed, 3 failed; green: 3 passed (K284).
- `make install-tools`는 `.php-version`의 PHP를 탐색해서 제공한다: PATH의 해당 minor `php`, 없으면 apt의 `php<minor>`, 없으면 Homebrew의 `opt/php@<minor>` keg. Composer 설치 전에 php, php-config, phpize의 exec wrapper를 var/tools/bin에 쓰므로, machine이 어떤 PHP를 PATH 앞에 두어도 모든 저장소가 고정된 PHP로 실행되고, 일치하는 것이 없으면 시도한 목록과 함께 실패한다. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-php.test.mts` 0 passed, 9 failed; green: 9 passed (K283).
- link는 소비자 자신의 환경의 각 프로젝트를 `--no-deps`로, 연결된 각 provider를 dependency와 함께 두 번의 install로 설치합니다. 소비자 자신의 프로젝트의 dependency는 소비자의 lock sync가 제공하므로, 다른 방식으로 제공되는 path dependency를 가진 프로젝트가 더는 install을 실패시키지 않습니다 (K280).
- directory suite의 case directory는 자신이 test하는 requirement를 `case.json`의 `requirements`(JSON으로 읽음)에 나열합니다. R15는 unit의 case 집합의 case.json 하나가 나열한 id를 이름이 있는 것으로 세고, 없거나 형식이 틀린 case.json은 declaration finding이며, docs/spec이 정의하지 않는 id는 R14입니다. unit은 `caseFile`을 선언해 그 파일을 가진 case directory만 가질 수 있습니다 (K277).

## 0.0.54

- ID는 마지막 -<number> 앞부분이 그 저장소 pattern의 ID일 때만 sub-item이므로, S-01 같은 ID 체계는 부모 S를 요구하지 않는다 (K249-5).
- parity 선언에는 `admit` key가 없다: 모든 구현이 모든 suite의 모든 case를 실행하므로, 한 구현이 건너뛰는 case는 더 이상 영구 차이가 아니다 (K276-1).
- config/parity.json은 모든 unit을 모든 구현이 가진다고 선언합니다: `profiles`, `nativeOnly`, `exclusions`와 unit의 `profile`이 없고(schema가 거부합니다), R8과 R11의 native-only 절이 없으며, width와 size suite는 모든 구현에 있습니다 (K276).
- suite 또는 feature unit은 각 binding의 test 또는 suite의 vector file이 이름으로 적은 requirement만 인용하고(R15), 그런 unit만 requirement를 추적한다: unit이 spec의 모든 requirement를 인용해 R13을 통과할 수 없다 (K275).
- parity declaration check는 인용된 spec file을 한 번만 parse한다: anchor마다 file을 다시 parse해서 큰 spec에서 8분이 걸렸다 (K274).
- config/parity.json은 requirements.pattern을 선언하고, 모든 unit은 자신이 test하는 requirement를 인용한다: docs/spec이 정의했으나 어떤 unit도 인용하지 않는 requirement는 실패하고(R13), 정의되지 않은 것을 인용하는 unit도 실패한다(R14). 구현을 가진 repository는 requirement id를 spec에 쓴다 (K273).
- kit-gates가 전체 parity check를 실행한다: config/parity.json의 모든 binding이 CI에서 각 구현마다 실행되므로, 한 언어에서만 test된 feature는 gate를 실패시킨다 (K272).
- kit 테스트가 installed version 규칙, TSX parser, release tag 단계를 따른다: 어떤 테스트도 version 비교를 기대하지 않고, 모든 sandbox 저장소는 initRepository로 만들며, 어떤 comment도 저장소를 이름 짓지 않는다 (K271).
- kit은 gate workflow `workflows/gates.yml`을 모든 저장소의 `.github/workflows/gates.yml`로 vendor한다. 저장소를 설치하고 PRINCIPLES.md의 규칙을 강제하는 모든 check인 `make -k kit-gates`를 실행하므로, 어떤 저장소도 gate를 CI에 손으로 연결하지 않는다 (K270).
- language check는 Go와 Rust의 raw string을 여러 줄에 걸쳐 데이터로 읽으므로, 그 안의 한국어 데이터는 identifier가 아니다 (K268-1).
- 저장소는 고정 작업이 아닌 suite target `check`를 유지하고, `make install`은 저장소가 더한 install 단계보다 먼저 kit의 bootstrap을 prerequisite `install-kit`으로 실행한다 (K246-2).
- release는 tag와 함께 release workflow를 dispatch해서 시작한다. `make release-tag`가 origin/main에 annotated tag를 만들어 push하고, tag가 이미 그 commit을 가리키면 통과하므로, 어떤 machine도 tag를 push할 필요가 없다 (K269).
- language check와 test-markers check는 JSX와 TSX를 읽는다. JSX를 읽지 못하는 Node.js의 type stripping과 acorn 대신, 이제 package의 의존성인 oxc-parser로 script를 해석하고 tree의 모든 node를 `script-ast.mts`에서 type으로 순회한다 (K268).
- kit-sync, kit-check, lint-ts는 버전과 상관없이 설치된 @polyspec/kit을 읽는다. npm ci가 lock의 integrity로 설치할 때 강제하며, 개발 상태인 kit checkout의 local link를 더는 버전 때문에 거부하지 않는다 (K267).
- kit 0.0.54가 K243~K266의 공통 표준과 함께 release된다 (K263).
- isolation test는 다른 polyspec 저장소 이름만 쓴다. history 재작성이 외부 프로젝트 이름을 공통 단어 consumer로 바꿔, 목록이 그것을 모든 곳에서 거부했다 (K266).
- vendored knip.json은 어떤 binary도 허용하지 않는다. K247이 `ignoreBinaries` php를 넣었는데, php를 실행하지 않는 저장소의 knip이 configuration hint를 출력했다. PHP extension test는 도구처럼 process.mts의 `execute`로 php를 실행한다 (K247-1).
- package test는 `make kit-build`로 kit을 build하고, package.json의 build와 prepack script도 그것을 실행한다. K246이 `make build`를 runtime 집계로 바꿨는데, Git과 var/tools의 node가 없는 복사본은 그것을 실행할 수 없다. runtime target과 PHP extension의 test는 isolation test가 요구하는 대로 다른 저장소 이름을 쓰지 않는다 (K246-1).
- commit check는 AI 도구가 commit의 author나 committer인 것을 range, commit-msg hook, `make commit`에서 거부한다(`commit-ai-identity`). test의 sandbox 저장소는 자기 identity를 가진다 (K265).
- commit check는 AI 도구의 footer, 곧 그 co-author나 session trailer 또는 generated-with 줄을 range, commit-msg hook, `make commit`에서 거부한다(`commit-ai-footer`) (K264).
- 없는 phpcs 또는 PHPStan은 install-tools가 거부하는 `make install-tools TOOLS=phpLint` 대신 config/php-lint를 설치하는 `make install-tools`를 안내한다 (K262).
- layout 규칙 suites-at-root가 적용된다. 어떤 규칙도 확장하지 않는 config/layout.kit.yml의 templates 안에 있어 어떤 checkout도 실행하지 않았다. 실제 layout test가 package 안에 suite를 심는다 (K244-1).
- PHP extension은 S10을 따른다. `packages/php`의 PHP library `polyspec/<repository>`를 구현하고, stub 하나 `src/polyspec_<repository>.stub.php`와 함께 `packages/php-ext/`에 두며, 이름은 `polyspec/<repository>-php-ext`와 `polyspec_<repository>`이다. `php-extension.mts`는 이름과 arginfo header의 stub hash를 확인하고(`make lint-php-ext`), phpize로 extension을 var/php-ext에 build하며(`make build-php-ext`), PHP의 gen_stub.php로 header를 쓰고(`make php-ext-arginfo`), unit test 전에 extension이 등록한 것을 Reflection으로 PHP library와 비교한다(`make test-php-ext`). layout 규칙은 다른 곳의 stub을 거부하고, kit의 CI가 lint와 test를 실행하며, knip은 binary php를 허용한다 (K247).
- 작업의 make target은 kit.mk와 kit-bootstrap.mk가 정의하는 고정된 이름을 가진다. `install`, `build`, `test`, `lint`는 `packages/`의 각 runtime의 target을 실행하고, `build-<runtime>`은 그 ecosystem의 build를 실행하며, documents-check는 `docs-check`이다. kit-check는 작업 이름으로 시작하면서 kit이 정의하지 않는 Makefile target과, build, test, lint target이 없는 runtime에서 실패한다. Claude Code hook은 CI에서만 실행하는 `make test`를 거부한다. kit 자신의 target은 고정 작업의 prerequisite인 `kit-build`와 `kit-install-symbols-php`이다 (K246).
- 공통 layout은 관심사마다 한 곳을 고정한다. `docs/`는 `spec/`, `operations/`, `plans/`, `rebuild/`, `features.md`와 VitePress site의 파일을 가지고, AGENTS, CHANGELOG, Makefile은 root에 두며, test 폴더는 `tests/`이고, `js` 폴더는 TypeScript를 가지지 않는다. kit의 tool inventory는 docs/operations/로 옮긴다 (K245).
- `make test-<runtime> CASES=<pattern>`(`runtime-targets.mts`)은 runtime의 각 package의 unit test를 그 runner의 name filter로 실행한다. `make test-integration`과 `make test-conformance`는 root의 `tests/integration/`과 `tests/conformance/`의 suite를 CI에서만 실행한다. layout 규칙은 suite를 package 밖에 두게 하고, Claude Code hook은 CASES 없는 test target과 suite를 거부한다 (K244).
- rules check는 규칙 문서에서 section을 소개하는 문단 밖의 문단에서 실패하므로, 규칙은 자기 check를 가진 list item이다. kit의 릴리스 절차는 docs/operations/release.md로 옮기고, AGENTS.md는 릴리스와 생성 파일 규칙을 list item으로 기술한다 (K243-1).
- commit 규칙은 모든 저장소에 같은 check-commits.mts의 상수 `COMMIT_RULES`이고, kit-check는 남은 `config/commits.json`을 알린다. PRINCIPLES.md에 plan, item, 검증, commit 규칙을 가진 Workflow 절이 있고, kit의 AGENTS.md는 그것을 다시 기술하지 않는다 (K243).
- `make language-check`(`language-check.mts`)는 data인 문자열을 빼고 code의 주석, identifier, error 또는 log message, test name의 한글에서 실패하고, commit check는 commit message의 한글에서 실패한다(`commit-language`). kit의 CI가 둘 다 실행한다 (K252).
- duplication check는 kit의 isolation test가 읽는, 실행하는 jscpd의 command를 명시한다 (K248-3-1).
- `make test-markers-check`(`test-markers.mts`)는 marker가 건너뛰거나 좁히는 test에서 실패한다. parser로 읽는 node:test 또는 vitest의 `test.skip`, `it.only`, `skip`, `only`, `todo` option과, code 줄의 `t.Skip`, `unittest.skip`, `pytest.mark.skip`, `markTestSkipped`, `#[ignore]`이다. kit의 CI가 실행한다 (K255).
- 삼킨 오류는 그 언어의 lint에서 실패한다. oxlint `no-empty`와 `no-useless-catch`, ruff BLE001, S110, S112, phpcs `Generic.CodeAnalysis.EmptyStatement`, clippy `let_underscore_must_use`, golangci-lint의 errcheck이며, 각각 test에 실패하는 sample이 있다 (K256).
- `make duplication-check`는 kit.mk의 도구(`duplication-check.mts`)이므로 모든 저장소가 실행한다. 이제 package의 dependency인 jscpd가 `config/duplication.json`이 이유와 함께 제외하는 folder 밖에서 checkout의 code를 runtime의 format으로 읽는다 (K248-3).
- kit은 2026-10-19 review 시점의 최신 stable release인 knip 6.42.0, @decimalturn/toml-patch 3.3.1, ruff 0.17.1을 lock한다 (K261).
- CI workflow test는 `.php-version`을 literal 8.5 대신 kit의 PHP pin과 비교한다 (K259-1).
- commit check는 oxlint가 요구하는 대로 fix commit의 type을 `startsWith`로 읽는다 (K257-1).
- push gate는 `{type}/{shortname}-{checklist id}`로 이름 붙지 않은 main 외의 push된 branch, `{project}-{shortname}-{checklist id}`로 이름 붙지 않은 worktree folder, main이 merge한 local branch를 그것을 제거하는 command와 함께 거부한다 (K253).
- commit check는 kit runner의 test 파일(tests/, `*.test.*`, `*_test.go`, `test_*.py`, `*Test.php`)을 바꾸지 않는 `fix` commit을 range, commit-msg hook, `make commit`에서 거부한다 (K257).
- `make kit-check`는 Git index의 symbolic link에서 실패하고 그것을 명시하므로, 어떤 저장소도 자신이 만든 link를 track하지 않는다 (K254).
- push gate test의 편집은 text에 일치가 없으면 그대로 두는 대신 실패한다 (K260).
- `make commit ID= TYPE= SCOPE= SUBJECT= BODY_FILE=`은 commit-msg hook의 check를 거친 뒤, body를 config/commits.json의 폭으로 감싸고 trailer를 그대로 둔 item의 message로 index를 commit한다 (K249-4).
- 열린 checklist item은 자기를 검증하는 command를 명시하고, 그중 Claude Code hook이 거부하는 것은 없으므로, documents-check는 suite로 검증하는 item에서 실패한다(`verification.mts`). `make item-test ID=`가 그 command를 실행한다. checklist header는 ID, Task, Deliverables, Verification, State로 고정된다. hook은 make target을 그 prerequisite와 recipe를 따라 읽고 `run-tests.mts <runner> -- <args>`를 그 runner로 읽으므로, 저장소 자신의 suite target도 거부된다 (K249-3).
- kit은 어떤 코드도 필요로 하지 않는 8.5 대신, 저장소의 코드와 도구가 필요로 하는 하한인 PHP 8.4를 pin한다. `toolchain-pins.json`과 `.php-version`이 8.4를 선언하고, kit의 Composer project는 platform 8.4(PHPUnit 13은 8.4.1)와 함께 `>=8.4`를 요구한다 (K259).
- PHP symbol extractor는 phpcs를 통과한다. visitor는 `extract.php` 옆 `PublicSymbols.php`의 class `Polyspec\Kit\Symbols\PublicSymbols`이다. extractor의 release는 kit PHP lint의 vendor/를 건너뛰고 다른 folder에서 실패한다 (K248-4-1).
- `make item-state ID= STATE=`는 허용된 전이를 따라 두 언어에서 item을 옮기고, working tree가 두 changelog에 그 줄을 추가할 때만 done을 설정하며, bypass의 원인과 재시도 조건, impossible item의 원인을 쓰고, commit-msg hook이 거부할 것을 거부한다(`workingItemFindings`). kit의 config/commits.json이 changelog를 선언하므로 commit check는 done item의 entry를 요구한다 (K249-2).
- `make item-new PLAN= ID= TASK= TASK_KO= DELIVERABLES= VERIFICATION=`은 checklist와 그 짝에 waiting row를 추가하고, sub-item은 부모의 마지막 sub-item 뒤에 두며, cell의 pipe를 escape하고, row가 추가할 documents-check의 finding을 거부한다. documents-check와 utility는 하나의 함수 `checklistsFindings`로 checklist를 읽는다 (K249-1).
- `make plan-new NAME= TITLE= TITLE_KO=`(`plan.mts`)는 plan folder를 네 파일, doc-id, 언어 link, checklist header, revision 표식과 함께 쓰고, slug가 아닌 이름, 이미 있는 plan, 빈 title을 거부한다 (K249).
- Composer installer의 comment는 Composer가 archive digest를 검사한다고 주장하는 대신, commit reference가 각 package를 고정하고 lock에 archive digest가 없음을 기술한다 (K258).
- 읽기가 state를 위치로 가져오므로, cell 수가 그 table의 header와 다른 checklist row는 줄과 두 수를 알리며 실패한다. kit의 checklist에서 그런 row 31개를 고쳤다 (K242).
- kit의 `make install-symbols-php`는 lint-php의 PHPStan을 위해 PHP symbol extractor의 package를 install하고, kit의 CI는 lint 전에 그것을 실행하며, `make build`는 그 vendor/를 dist/에서 뺀다 (K248-4).
- @polyspec/kit/test-output의 export test는 tests/source에서 build된 copy로 실행되므로, vendor된 test에는 dist/가 필요 없다 (K250-1).
- go extractor test는 sandbox에 checkout의 install을 가리키는 mise wrapper를 준다. K199가 그 install로 extractor를 build한다 (K250-3).
- K208 trust test는 shim의 environment에서 CI와 GITHUB_ACTIONS를 제거한다. 둘 중 하나가 설정되면 mise가 모든 config file을 trust하기 때문이다 (K250-2).
- test의 sandbox 저장소는 receive.autogc를 false로 설정하여, git 2.43에서 그 저장소로의 push가 gc를 시작하지 않는다 (K250-4).
- parity 선언 test는 initRepository로 저장소를 만들고 실패한 git command에서 실패한다 (K248-2-1).
- plan은 `plan.md`, `checklist.md`와 그 한국어 짝을 가진 folder `docs/plans/<plan>/`이며, kit은 이 folder로 checklist를 찾는다 (K241). `config/checklist.json`은 hook과 ID pattern만 가진다. checklist는 state 5개를 가진 table이므로 list format과 선언된 state는 제거된다. 다른 파일이 있거나 plan이 없는 folder, 두 checklist에 있는 item ID, 부모가 없는 sub-item은 파일과 줄을 알리며 실패한다. document check는 plan folder 밖에서 checklist item을 가진 docs/ 아래 문서를 다시 실패시킨다. 이는 K240이 full-run과 함께 제거한 K235의 check다. kit의 execution checklist는 plan tool-unification과 standards-enforcement로 나뉘고, local-links는 docs/operations/로 옮긴다.
- PRINCIPLES.md와 AGENTS.md의 모든 규칙은 `Enforced by:`로 끝나며, `make rules-check`(`check-rules.mts`)가 명시된 check를 CI workflow와 Git hook에서 make를 따라 추적하고, 그런 지점이 실행하지 않는 check를 가진 규칙에서 실패하며, tool이 강제하지 않는 규칙과 planned item이 강제할 규칙을 나열한다. Claude Code hook은 `--no-verify`, `core.hooksPath` 변경, sleep으로 polling하는 loop, consumer에서 vendor된 파일의 편집도 거부한다. kit의 CI는 PHP, Python, Go lint, rules check, parity 선언을 실행한다 (K248).
- 구현 folder가 최대 하나인 checkout은 `config/parity.json`이 필요 없고, 둘 이상인 checkout은 그것 없이 실패한다 (K248-2).
- kit.mk가 `rebuild-check`와 `rules-check`를 정의하여 모든 저장소가 그것을 실행한다 (K248-1).
- kit CI의 모든 check step은 앞의 step이 실패한 뒤에도 실행되어, run 하나가 모든 실패를 보여 준다 (K251).
- 공통 layout은 Claude Code가 설정을 읽는 `.claude/`를 허용하고, kit의 layout은 vendor되는 설정의 원본 `claude/`를 허용한다 (K240-2).
- full suite는 CI에서만 실행된다 (K240). `make ci-targets`, 전체 `make parity-check`, `make owner-check`의 실행, test file, 이름, id를 선택하지 않은 test 실행은 GitHub Actions run 밖에서 거부한다(`ci-only.mts`, `test-selection.mts`). `full-run.mts`, 그 record, kit의 `make check`와 `make rerun-failed`를 제거했다. kit은 `.claude/settings.json`을 vendor하며, 그 PreToolUse hook(`claude-hook.mts`)은 suite target, selection 없는 test runtime 전체를 실행하거나 GITHUB_ACTIONS 또는 CI를 설정하는 Bash command를 거부한다.
- isolation test는 module-imports.mts로 module의 import를 읽어, `--import` 같은 option 이름을 가진 문자열은 import가 아니다 (K240-1).
- lint-ts가 다시 통과하고, kit의 어떤 module과 test도 다른 저장소를 지명하지 않고(fsm과 flowmark도 목록에 있다), make test는 모든 make release가 출력하는 것을 assert하며, read-only link test는 link가 읽는 쓰기 가능성에 따른 동작을 assert하여 root로 실행해도 통과한다 (K250).
- Python link는 sync를 실행하지 않고 link한 package만 바꾼다 (K239).
- Python unlink는 모든 group의 release를 복원하고 consumer project를 남긴다. link는 marker를 포함해 uv pip check로 의존성을 검사한다 (K238).
- Python link는 consumer가 설치한 package를 지우지 않고 link한 checkout의 의존성을 설치한다. unlink도 지우지 않는다 (K237).
- 전체 `make parity-check`는 makefile을 읽는 동안 full-run gate를 실행해, 저장소가 덧붙인 선행 target보다 먼저 거부한다 (K236).
- 어떤 tracker도 선언하지 않은 docs/ 아래의 checklist 항목 문서는 전체 실행과 gate를 거부한다 (K235).
- kit에 full-run guard로 전체 suite를 실행하는 `make check`가 생기고, UNITS 없는 `make parity-check`는 항목이 대기이거나 active이면 거부하는 `full-run gate`로 시작한다 (K234).
- 전체 실행 guard는 항목이 대기(`[ ]`)일 때도 거부한다. 완료, 우회, 불가 항목만 남을 수 있다 (K233).
- `config/parity.json`의 implementation이 자기 runtime에서 test를 실행하는 같은 runner의 implementation을 `shares`로 선언할 수 있고, R6은 그 binding을 그 implementation의 root 안에서 받아들인다(K232).
- `make parity-check`는 database item마다 실행되는 TypeScript coverage case의 보고(`<case> [<database>]`)를 그 case로 묶습니다. case는 모든 보고가 통과해야 통과하며, PHP data set과 Python item과 같습니다. 그 밖의 반복된 이름은 여전히 R3입니다(K231).
- `make parity-check`는 PHPUnit feature binding이 선언한 id, 즉 `<Class>::<method>`(PHPUnit이 보고하는 id) 또는 bare method와 맞춥니다. 그래서 `RollbackTest::test_rollback_failed` 같은 orm binding이 R3 not-executed 대신 통과합니다. cargo는 test의 이름과 결과 사이에 출력이 끼었을 때 줄 하나에 홀로 적힌 결과를 읽으므로, 데이터베이스에 연결하는 `identity_load` case가 실행된 것으로 셉니다(K229).
- kit parity 선언은 언어 parity만 담습니다. 소비자 interface manifest는 parity.json 키가 아니라 spec anchor로 참조합니다(K227).
- `link`는 프로젝트 자신이 제공하는 의존성을 NOT linked 대신 `workspace`로 보고하고 충족된 것으로 봅니다: `npm query`가 프로젝트의 폴더에 나열하는 npm workspace member, 그리고 루트 composer.json 또는 그것이 선언한 path repository의 Composer 이름입니다. 체크아웃도 프로젝트 패키지도 제공하지 않는 의존성은 여전히 실패합니다(K226).

- Python editable wheel의 fingerprint는 추적되거나 새로 생긴, 무시되지 않은 파일의 디렉터리만 셉니다. 그래서 읽기 전용 checkout 아래 컨테이너가 쓰는 git-ignored var/ 디렉터리가 fingerprint를 바꾸지 않고, 호스트에서 만든 wheel을 다시 씁니다(K225).

- parity binding `command`의 단어는 실행 environment를 `${NAME}`으로 참조할 수 있습니다. binding을 실행할 때 구현의 `command`, `args`, `env`와 같은 규칙으로 풀리며, NAME이 설정되지 않았거나 비었으면 그 NAME을 적은 R3 finding이고 그 binding은 아무것도 실행하지 않습니다. 이전에는 `${NAME}`을 그대로 실행했습니다(K223).
- `link`는 제공자와 같이 동기화된 환경의 모든 Python 프로젝트를, 소비자 자신과 polyspec 의존 여부와 무관한 각 workspace member까지 editable wheel로 설치한다(K224). sync는 `uv sync --locked --no-install-project`이다(uv workspace root면 `--no-install-workspace`). 그래서 읽기 전용 소비자 checkout에서 `os.utime`으로 실패하던, 프로젝트를 제자리에서 빌드하는 일이 없다. wheel은 패키지 폴더가 쓰기 가능하면 `var/link/wheels/<name>/<fingerprint>/`에 만들고, 읽기 전용이면 있는 것을 재사용한다. 읽기 전용 폴더에 wheel이 없으면 `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`로 실패한다. 모든 wheel을 sync 전에 먼저 확인하므로 하나라도 없으면 환경은 그대로 둔다. `check`는 설치된 각 wheel의 fingerprint를 검사한다. `unlink`는 여전히 전체 `uv sync --locked`로 각 프로젝트 자신의 설치를 복원한다(K224).

- `link`는 Python 제공자를 editable wheel로 연결한다(K222). 각 제공자는 `uv sync --locked` 뒤에 `var/link/wheels/<name>/<fingerprint>/`의 wheel로 `uv pip install --no-deps`를 한다. 이전의 `-e`와 `--overrides` 파일은 없어졌다. checkout이 쓰기 가능하면 그 pyproject의 backend로 격리된 `uv run`에서 wheel을 만들고, 읽기 전용 checkout(컨테이너 마운트)은 미리 만든 wheel만 설치하며 트리에 쓰지 않는다. 그곳에 wheel이 없으면 `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`로 실패한다. `check`는 설치된 wheel의 fingerprint가 checkout의 것과 다르면 실패한다. `link`와 `restore`는 같은 sync를 쓴다.

- `make parity-check UNITS="<id> …"`는 `config/parity.json`의 이름 붙은 unit만 실행합니다. `scripts/kit/parity.mts --unit <id>`(반복 가능)는 그 binding을 전체 실행과 같은 runner, cwd, reader로 실행하고 결과를 일반 ledger 줄로 보고합니다. unit 전체가 필요한 cross-unit rule(R1, R2, R4~R11)은 실행하지 않으며, 출력이 그 사실을 한 줄로 적습니다. 어떤 unit도 갖지 않은 id는 실행 없이 그 id를 적은 오류입니다 (K221).

- `link`는 provider checkout의 private npm 패키지도 다른 패키지와 같이 연결한다. manifest의 `package.json` `name`은 `private` 여부와 관계없이 제공한다. `private`는 게시만 막고 로컬 연결과는 무관하므로, tgz에서 설치된 복사본이 링크로 바뀌고 `check`가 통과한다. 제공자가 이름을 제공하는 npm 패키지는 `/*`만이 아니라 모든 scope(예: `/*`)를 연결한다(K220). 같은 이름의 manifest가 둘이면 전과 같이 둘 다 밝히며 실패한다(K220).

- `run-tests python --module <name>`는 Python 테스트를 `unittest` 대신 그 module(`python -m <name> …`)로 실행한다. 그래서 자체 harness로 테스트를 실행하는 저장소(예: orm의 `packages.python.tests.testcase`)도 같은 reader로 harness의 case를 센다. module 옵션은 python 도구에서만 읽는다 (K219).

- `run-tests node`는 helper module이 등록한 case(`test()`를 부르는 case 함수, 예: orm의 `caseTest`)를 `node --test`가 실행하는 test 파일의 case로 센다. node는 파일을 하나씩 실행하므로(`--test-concurrency=1`) 각 case는 그 파일의 group 이벤트가 연 파일에 속한다. 그래서 helper가 등록한 case의 파일이 `the file ran no test case`로 실패하지 않는다. test가 하나도 실행되지 않은 실행은 여전히 실패한다 (K218).

- `scripts/kit/test-output.mts`의 `nodeEvents`(`@polyspec/kit/test-output`)는 parity의 node:test reporter(parity-node-reporter.mts)가 내는 줄을 sink로 읽는다. goEvents, cargoEvents, pythonEvents, phpunitEvents가 각 도구의 출력을 읽는 것과 같다. 언어 parity 검사는 node의 case를 이것으로 읽고, consumer도 node:test case를 같은 방식으로 센다. case가 없는 실행은 아무 case도 읽지 않는다 (K217).

- parity binding은 `command`로 그 binding을 실행할 명령을 적습니다. 이 argv 배열은 runner의 기본 명령을 대신합니다(예: orm의 데이터베이스별 feature를 위한 `["make", "feature-check", "ITEM=…"]`). runner는 그 명령의 출력을 기본 명령의 출력과 같은 방식으로 읽고, 필드는 모든 unit 종류에서 받습니다. 시작하지 못하거나 0이 아닌 상태로 끝나는 명령은 그 명령을 이름 붙인 R3이며, 기본 명령으로 대신하지 않습니다 (K216).

- `make parity-check`는 timing을 붙인 cargo 하네스(orm testcase crate가 출력하는 libtest-mimic)의 출력을 읽는다. 이 출력은 test 이름 줄 다음 줄에 결과가 나온다. 그래서 선언된 case가 모두 통과한 rust binding의 각 case를 통과로 센다(이전에는 0개로 셌다). suite 실행은 선언된 case 중 통과한 것만 세므로 셈이 선언된 개수를 넘지 않는다. 종료 0인 실행에 선언된 case가 없으면 그 이름을 적고 실패하며, 실패한 실행이 test 이름을 보고하지 않으면 출력의 마지막 20줄을 보인다 (K215).

- `make parity-check`는 feature 실행을 패키지 전체가 아니라 `-run ^(<top>|…)$`로 실행한다. 이 정규식은 id의 첫 `/` 앞 top-level test 이름을 이스케이프해 하나의 선택으로 묶은 것이다. 그래서 feature가 많은 패키지도 test 파일마다 그 test만 실행되고, 관계없는 test의 실패가 모든 unit을 실패시키지 않는다. suite 실행은 symbol을 그대로 쓴다 (K214).

- `make parity-check`는 feature 실행이 0이 아닌 상태로 끝나면, 그 실행이 보고한 실패 test 중 id가 아닌 것의 이름을 줄에 적는다. 이름은 `go test -json`의 Test 이름을 가진 fail 이벤트와 node:test reporter에서 읽는다. 읽을 이름이 없으면 `failed outside the ids: no test name readable from the output`로 그렇게 적는다. 이전에는 종료 상태만 출력했다 (K213).

- `link.mjs link|check|unlink --project <dir>`는 `<dir>`의 manifest를 Git 추적 여부와 관계없이 그 폴더에서 직접 읽는다. 그래서 git-ignored 트리(var/example/installation) 아래의 설치도 package-lock.json 없이 npm 사본을 링크한다. manifest가 없는 `<dir>`이나, checkout이 제공하는데 실행이 링크하지 않은 선언된 polyspec 패키지는 0으로 종료하지 않고 이름이 붙은 오류로 실패한다(K212).

- `make install-tools`는 checkout의 mise.toml 신뢰를 state dir에 `mise trust`로 기록하며, 어떤 환경 변수도 그것을 신뢰시키지 않는다. parity의 python extractor는 새 worktree에서 그 변수 없이 실행된다(K208).

- Rust symbol extractor의 rustdoc 스키마가 format 61(`format_version` 61, 문자열 `macro`)을 읽는다. config/toolchain.json의 Rust nightly가 내는 형식이며, 이 형식에서 R1 추출이 실패했다(K207).

- `make install-tools`는 go symbol extractor를 `GOWORK=off`로, mise의 Go 환경(`-mod=readonly`, var/tools 아래의 GOPATH와 GOCACHE)에서 build한다. extractor는 consumer의 node_modules 아래에 있는 별도 module이므로, 그것을 나열하지 않는 consumer의 root `go.work`가 "current directory is contained in a module that is not one of the workspace modules listed in go.work"로 build를 멈췄고(template), module cache와 build cache는 machine의 것을 썼다 (K196).

- `make parity-check`의 R10은 each나 각각 뒤의 수를 그 문장의 implementation count로 읽지 않고("Go module, Rust crate, PHP package, PHP extension, Python package도 각각 한 구현이다"), 열거의 다른 항목이 양쪽에 있는 implementation 이름의 run을 implementation의 list로 읽지 않는다("Node.js, npm, Go, Rust, PHP minor version, Composer"). template의 참인 두 문장이 check에서 실패했다 (K197).

- `make install-tools`는 go symbol extractor를 mise의 shim 대신 consumer의 go로, 곧 consumer root에서 `mise where go`가 출력하는 install의 bin/go를 절대 경로로 실행하여 build한다. kit을 링크한 consumer에서는 extractor 소스가 kit checkout으로 resolve되고, shim은 그곳에서 kit 자신의 mise.toml을 읽어 "Config files in …/kit/mise.toml are not trusted"로 멈췄다 (template, K199).

- `make link`, `make link-check`, `make unlink`(scripts/kit/link.mts)는 0.0.x 개발의 local link를 만든다(docs/plans/local-links.md): `CHECKOUTS`가 지정한 main checkout이 패키지를 제공하고, 각 제공자는 release-assets의 prerequisite로 build하며, npm의 hidden lockfile과 Composer의 installed.json이 기록한 사본은 제공자 폴더를 가리키는 링크가 되고, Python 패키지는 의존과 --overrides 파일을 준 uv install 한 번으로 editable 설치하며, 각 Go 모듈은 go가 스스로 읽는 git 무시 go.work를 얻는다. `make install-packages`는 빌드도 링크도 하지 않는다 (K201, K205).

- `make parity-check`는 vitest를 test를 가진 implementation의 root를 `--dir`로 주어 실행한다. checkout root에서는 vitest의 discovery가 home 폴더로 링크하는 mise의 trust 기록 var/tools/mise/state/trusted-configs를 따라가 같은 test의 옛 사본까지 찾았으므로 case가 두 번 보고되었다 (template, K202).

- `make link`(scripts/kit/link.mts)의 링크는 각 도구 자신의 기록(npm query, Composer의 installed.json, uv pip list, go mod edit -json)에서 읽은 0.0.x 고정 패키지만 링크하고, `composer config vendor-dir`이 각 Composer 프로젝트에 주는 vendor를 링크한 뒤 autoloader를 다시 쓰며, polyspec 패키지의 plain copy를 경로와 함께 NOT linked로 보고하고, 빌드하지 않으며(`link.mjs rebuild`가 빌드하고 `link-check`는 STALE을 보고한다), Git이 무시하는 경로에만 쓰고, release target과 `dependency-review`를 `GOWORK=off`로 실행한다. kit의 `make build`는 완성된 dist.next를 dist로 rename하고, (K201-1).

- `link.mjs`는 checkout을 인자로 받고 환경 변수를 읽지 않는다(K205): `link.mjs link|check [--project <dir>] <checkout>...`, `unlink [--project <dir>]`. kit이 없는 소비자는 `node <kit checkout>/dist/link.mjs`를 실행한다.

- `link`는 Python provider를 환경이 editable install을 가질 때만 linked로 보고합니다. 설치된 상태는 venv 자신의 python이 읽고(PEP 610 direct_url.json과 RECORD의 PEP 660 `__editable__` marker), 설치 후에도 다시 읽습니다. 예전에는 wheel의 `uv pip freeze` 경로를 믿었는데 non-editable 설치도 같은 경로를 가지므로 site-packages 복사본이 있는 venv가 `linked`를 출력했습니다. 이제 그런 venv는 NOT linked로 실패합니다(K230).

## 0.0.53

- `make release-proof`는 wheel이 요구하는 각 sibling의 asset을 release가 나열하는지 확인하고 URL은 비교하지 않는다. sibling의 URL을 draft가 나열하는 URL과 비교했으나, GitHub은 draft가 publish되기 전까지 그 asset을 `untagged-` URL로 나열하므로 sibling wheel이 있는 첫 release가 proof에서 실패했다(crudui v0.0.6). sibling의 URL, 곧 tag의 asset URL은 release가 build되기 전에 확인된다 (K195).

## 0.0.52

- `config/owner-checks.json`의 owner rule은 `importers`와 `modules`를 받는다: 변경된 경로는 `importers` glob의 node test 중에서 그 경로를 직접 또는 다른 module을 거쳐 import하는 test를 실행하며, import는 owner-check의 import graph가 읽는다(`module-imports.mts`: amaro, acorn, acorn-walk; relative import, re-export, `import()`, `require()`, `import.meta.resolve('<specifier>')`, `siblingTool(import.meta.url, '<name>')`). `modules`는 schema나 fixture처럼 module이 아닌 경로를 대신하는 module을 적는다. `make owner-validate`는 그런 rule의 경로 중 어떤 test도 import하지 않는 경로에서 실패한다. kit의 rule이 이것을 쓴다: scripts/kit의 module 변경은 도구 suite 전체인 `make kit-test`를 실행했고, 이제 그것을 import하는 test를 실행한다; package 파일은 그것을 읽는 check를 실행한다 (K191).

- make kit-check는 PHP가 필요한데 `.php-version`이 없는 저장소에서 실패한다: `config/release.json`의 Composer package나 Composer consumer, 또는 `config/toolchain.json`의 `php`가 있는 저장소이다. release workflow는 `.php-version`의 PHP만 설치하고 그 밖에는 runner의 PHP를 유지했으므로, PHP를 다른 곳에 고정한 저장소는 Ubuntu의 PHP로 release하여 release proof에 실패했다. release workflow는 이제 make install-packages 뒤, 어떤 release 단계보다 먼저 make kit-check를 실행한다 (K193).

### Consumer migration

PHP가 필요하고 `.php-version`이 없는 저장소는 `8.5` 같은 PHP minor release로, `config/toolchain.json`의 `php`가 있으면 그 minor로 그것을 선언하고, 새 release workflow를 위해 make kit-sync를 실행한다 (K193).

K191에는 할 일이 없다: source 변경에 test suite 전체를 실행하는 owner rule을 가진 저장소는 대신 node test의 glob으로 `importers`를 선언하고, test가 시작만 하는 도구는 `import.meta.resolve`로 이름을 적을 수 있다 (K191).

## 0.0.51

- make toolchain-check는 mise.lock이 가리키는 uv lock sidecar(`pypi:` 도구의 `uv = { path = ".mise/locks/<tool>/<version>" }`)를 Git이 track하지 않거나 그 track한 파일이 없을 때 실패한다. mise의 문서는 sidecar folder를 mise.lock과 함께 commit하라고 하며, 그것이 없는 checkout의 `mise install --locked`는 "dependency sidecar … No such file or directory"로 실패한다; 그것을 지웠거나 commit하지 않은 저장소는 이제 해결 방법과 함께 finding을 받는다 (K192).

- make lint-ts는 knip.json 사본의 ignore를 knip이 필요로 하는 곳에서만 남기며, 그 판단은 knip 자신이 한다: reporter `knip-ignore-hints.mts`로 knip을 먼저 실행해 아무 issue에도 맞지 않은 ignore에 대한 knip의 configuration hint를 얻고, 그것을 lint의 설정에서 뺀다. script가 `@polyspec/kit`을 import하는 레포는 고칠 수 없는 사본에 대해 "Remove from ignoreDependencies" hint를 받았다; 이제 받지 않는다. 이는 같은 실행이 다루는 K176의 선언된 package 기준 filter를 대체한다 (K188).

- make dependency-review UPDATE=1은 npm 명령(npm install, npm audit fix, npm dedupe)을 make install-packages의 npm ci와 같은 설정인 allow-remote=root로 실행한다: `kit-bootstrap.mk`는 그 설정의 하나의 source로 `npm_config_allow_remote=root`를 두 recipe에 export한다. npm audit fix는 그것 없이 실행되어 URL로 고정된 `@polyspec/kit`을 EALLOWREMOTE로 거부했다; install-packages의 recipe는 이제 같은 설정을 읽는 `npm ci`이다 (K189).

- config/release.json의 wheel package의 `pyproject.toml`을 source로 하는 make python-lock은 sibling(configuration의 다른 wheel package)을 release asset의 URL로 가리키는 requirement를 resolution에서 뺀다. 이는 wheel-dependencies가 sibling link로 분류하는 requirement와 정확히 같다: uv는 그 이름의 `--excludes`와 함께 실행되고, make python-lock-check는 그것을 비교에서 뺀다. 그런 URL은 release가 publish한 뒤에야 존재하므로 lock은 404로 실패했고, sibling에 의존하는 wheel은 lock할 수 없었다; sibling을 가리키지 않는 URL requirement는 전처럼 해석되고 검사된다 (K190).

- kit-check의 recipe-tools check는 shell-quote가 line을 나누는 동안 make reference 자리에 두는 placeholder인 `KIT_MAKE_REFERENCE_`를 이미 담은 recipe line에서 실패한다. 그런 word는 reference로 읽혔다: line의 reference 범위를 넘는 것은 빈 word가 되어 버려졌고, 범위 안의 것은 다른 reference의 word를 가졌다; 이제 그 line은 자기 text와 해결 방법(그 변수의 이름을 바꾼다)과 함께 실패한다 (K187).

### Consumer migration

mise.toml에 `pypi:` 도구를 선언한 저장소는 `make toolchain-lock`이 쓰는 `.mise/locks/` folder를 mise.lock과 함께 commit한다; 그것을 지운 저장소는 `make toolchain-lock`을 다시 실행한다 (K192).

## 0.0.50

- parity의 php binding은 run-tests와 lint-php처럼 그 package에 Composer가 주는 vendor directory의 PHPUnit을 실행합니다(composer-vendor.mts): package 자신의 것, 또는 그 위의 가장 가까운 Composer project의 것입니다. root composer.json이 path repository로 library를 require하고 root에 `vendor/` 하나를 설치하는 Composer monorepo(K163)는 모든 php binding을 "`<package>/vendor/bin/phpunit` does not exist"와 함께 R3 not-executed로 보고했습니다; 이제 그것을 실행하며, 위로 vendor directory가 없는 package는 여전히 해결 방법과 함께 실패합니다(K178).
- kit-check의 recipe-tools 검사(K171)는 POSIX shell의 quoting 규칙으로 recipe line을 나눕니다: quote된 문자열은 한 word이고, quote 안의 `|`, `;`, `&&`는 operator가 아닙니다. `@echo "build-ts|go|…"` 같은 help line은 go를 bare name으로 시작한다고 보고되어 문구를 바꿔야 했습니다; 이제 통과하며, `foo | node x`는 여전히 실패합니다(K179).
- composer.json의 version을 정하는 릴리스는 그 directory에서 `composer update --lock`으로 다시 lock합니다: `composer.lock`의 content-hash가 `version`을 포함하므로 version 변경만으로는 낡은 lock이 남고, `make dependency-policy-check`가 그것을 실패시킵니다(`composerLock`). AGENTS.md와 docs/operations/tool-inventory.md의 릴리스 절차가 이를 말하며, `make dependency-policy-mutation-check`는 새 lock 없는 version 변경이라는 mutation을 얻고 gate는 그것을 거부해야 합니다(K180).
- make dependency-policy-check가 checkout의 모든 Composer manifest를 검사합니다: `composerPlatforms`가 지정하지 않고, 그것이 지정한 manifest의 path repository가 제공하지도(K168) 않는 추적된 composer.json은 rule `composerCoverage`로 실패합니다. 이전에는 Composer platform을 하나도 적지 않은 저장소가 어떤 manifest에도 `composer validate --strict`를 실행하지 않았으므로, version 변경이 낡게 만든 lock이 release를 지나도록 낡은 채 남았습니다. kit이 쓰는 manifest, kit이 배포하는 symbol extractor project, `config/release.json`의 Composer consumer project는 검사하지 않습니다(K181).
- `config/owner-checks.json`이 `ciExempt`를 받습니다: 저장소의 CI workflow가 실행하지 않는 owner rule의 make target과 각각의 이유입니다. kit의 CI workflow test는 다른 모든 owner target에 step을 요구합니다; kit의 CI는 이제 실패가 local 실행까지 숨어 있던 make toolchain-check, kit-check, release-coverage를 실행하고, make install-hooks가 쓰는 local core.hooksPath가 필요한 hooks-check를 면제합니다(K183).
- kit-check의 recipe-tools 검사는 자체 splitter(K179) 대신 kit의 새 dependency인 shell-quote 1.12.0의 `parse`로 recipe line을 shell word로 나눕니다; kit의 모든 recipe와 기존 case의 word는 같고, `$(if $(RANGE),--range $(RANGE))` 같은 중첩된 make function은 더 이상 엉뚱한 command `if`를 내지 않습니다(K184).
- run-tests, lint-php, parity의 php runner는 Composer project의 vendor directory를 Composer에게 묻습니다: kit이 복사한 규칙(K163, K178) 대신, checkout의 mise.toml의 Composer로 composer.json의 folder에서 offline으로 실행하는 `composer config vendor-dir`입니다. kit이 무시하던 composer.json의 `config.vendor-dir`도 이제 `vendor`, `COMPOSER_VENDOR_DIR`와 함께 반영됩니다; package 위의 가장 가까운 Composer project를 찾는 것은 그대로입니다. 이 도구들은 이제 make install-tools가 설치하는 mise.toml의 Composer(`http:composer`)가 필요합니다(K184).
- `kit-bootstrap.mk`는 package가 설치되기 전에도 `$(NPM)`처럼 bootstrap이 설치하는 checkout의 node인 `$(NODE)`를 정의합니다. install-packages가 필요로 하는 step처럼 kit.mk가 생기기 전에 도는 저장소의 recipe는 빈 `$(NODE)`를 받아 var/tools/bin/node를 직접 적어야 했습니다(K185).
- run-tests phpunit은 parity와 lint-php처럼(K178) composer-vendor.mts의 같은 function으로 `--cwd` 또는 그 위에서 PHPUnit이 있는 가장 가까운 Composer project의 PHPUnit을 실행합니다. 자기 vendor directory가 없는 Composer monorepo의 package는 root를 `--cwd`로 넘겨야 했습니다; 이제 자기 folder에서 실행합니다(K186).

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

oxlint가 보고한 파일 중 저장소의 code가 아닌 것은 disable 주석이나 oxlint의 ignore 대신 이유와 함께 `config/knip-entries.json`의 `ignore`에 넣습니다(K172). VS Code를 설치하는 저장소는 kit 갱신과 함께 make install-vscode의 수정을 받으며, 설정에서 바꿀 것은 없습니다(K173). test가 자기 `dist`를 import하고 knip이 export를 unused로 보고하는 package는 build를 `outDir`, `rootDir: src`, `composite: true`를 둔 자기 tsconfig에 두고, test를 유지하는 `tsconfig.json`의 `references`에 그것을 적습니다. 설정은 `docs/operations/tool-inventory.ko.md`에 있습니다(K175).

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
