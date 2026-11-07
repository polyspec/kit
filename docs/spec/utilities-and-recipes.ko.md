<!-- doc-id: spec-utilities-and-recipes -->
<!-- source-sha256: 3058d32cd59985ea6c470d77dc020adf3c9b50158b36d1484785b74f16436f84 -->
# 유틸리티와 예제

[English](utilities-and-recipes.md)

## 문제

kit은 레시피를 강제한다. 레시피 한 벌(`scripts/kit/kit.mk`, `scripts/kit/kit-bootstrap.mk`, K1054 전까지)을 모든 저장소에 include시키고, 공유 CI에서 자기 검사의 결과를 필수로 요구한다. 모든 저장소가 함께 쓰는 레시피는 저장소마다의 경우를 감당해야 하므로, 새 경우마다 공유 덩어리에 분기, 스위치, 덮어쓰기가 붙었다. `UV_NO_CONFIG`, `MISE_*`, `unexport CARGO_TARGET_DIR`, `INSTALL_PACKAGES_EXTRA`, `npm_config_allow_remote=root`가 그 예다. 명령줄이나 환경변수의 덮어쓰기는 저장소 자신의 설정보다 우선하고, 필수 검사는 예상하지 못한 경우를 거부한다. 어느 쪽이든 저장소에 남는 수는 우회뿐이다.

allow-remote 사례가 그 연쇄를 보여 준다.
1. kit은 K1045 전까지 `allow-remote=root`를 강제했다.
2. 제공 라이브러리가 URL로 적은 의존성을 npm이 거부한다.
3. 제공 라이브러리는 어느 레지스트리도 내주지 않는 버전 번호로 물러선다.
4. 각 소비자가 그 패키지를 루트에 선언하고, `overrides`로 다시 고정하고, knip의 정확한 "안 쓰는 의존성" 지적을 막는다.

## kit이 제공하는 것

1. **유틸리티.** 유틸리티는 받은 인자와 파일로 동작이 정해지는 스크립트다. 도구 설치기, 검사기, parity 도구, 릴리즈 도구가 여기에 든다. 일부 유틸리티는 저장소의 레시피를 실행한다. 저장소가 이름을 대는 target을 실행하는 것으로, CI target 실행기(`ci-targets`), 저장소 자신의 설치를 실행하는 worktree 설정, 테스트 실행기가 그 예다. 저장소는 원하는 유틸리티를 자기 레시피에서 실행한다. 유틸리티는 레시피를 적힌 그대로 실행한다. 잘못된 레시피는 잘못된 대로 실행되며, 유틸리티는 그것을 판정하지 않는다. 유틸리티가 멈추는 것은 자기 일을 할 수 없을 때뿐이다. 도구가 없을 때, 커밋하지 않은 변경이 있는 main checkout에서 land할 때가 그 예다.
2. **예제.** `docs/examples/`는 저장소들이 보편적으로 일하는 방법을 주제마다 작동하는 예제 하나로 보여 준다.
   - row의 worktree를 어떻게 짜고 그 안에서 어떻게 일하는가
   - 레시피를 어떻게 짜는가: 유틸리티를 실행하는 Makefile의 설치, 빌드, 테스트, lint, 릴리즈 target
   - 네이티브 설정을 어떻게 적는가: `.npmrc`, `uv.toml`, `mise.toml`의 `[settings]`, `.cargo/config.toml`
   - CI workflow를 어떻게 짜는가
   - 개발 중에 형제 checkout을 어떻게 링크하는가
   - 체크리스트 row를 Red부터 커밋까지 어떻게 진행하는가

   예제는 작동하는 방법 하나를 보여 준다. 저장소는 그것을 복사하거나, 바꾸거나, 무시한다.

## kit이 하지 않는 것

kit은 어떤 것도 강제하지 않는다. 특히 다음과 같다.

- kit은 저장소에 레시피를 include시키지 않는다.
- kit은 다른 도구의 설정을 정하지 않는다. 명령줄에서도, 환경변수에서도, 유틸리티가 실행하는 도구의 환경에서도 그렇다. 도구 설치기는 자기가 설치하는 것을 어디에 두는지 정하며, 그것은 설치기 자신의 일이다. mise 설치기는 자기가 설치하는 mise의 디렉터리와 그 shim이 읽는 checkout의 설정 파일을 정하고(`MISE_DATA_DIR`, `MISE_CACHE_DIR`, `MISE_STATE_DIR`, `MISE_CONFIG_DIR`, `MISE_GLOBAL_CONFIG_FILE`, `MISE_GLOBAL_CONFIG_ROOT`), `var/tools` 아래에 도구를 빌드하는 Go는 자기 module cache와 checksum database를 받는다(`GOPATH`, `GOCACHE`, `GOFLAGS`, `GOSUMDB`). 이 중 어느 것도 저장소의 도구가 어떻게 동작할지를 정하지 않는다. 같은 방식으로 PHP의 lint는 PHPStan에 메모리 제한을 두지 않게 하고(`--memory-limit=-1`), 패키지의 Composer가 쓴 autoloader를 준다(`--autoload-file`). 메모리 제한은 PHPStan이 어떤 설정 파일에서도 읽지 않는 프로세스의 한계다.
- kit은 저장소의 CI, hook, gate에 어떤 결과도 필수로 요구하지 않는다.
- kit은 저장소의 레시피나 예제를 검사하는 기능을 제공하지 않는다.

## 근거

- 강제한 설정과 필수 결과 하나하나가 저장소의 선택을 없앴다. 저장소의 경우가 kit의 예상과 다르면 남은 수는 우회뿐이었다. "문제"에 적은 덮어쓰기는 모두 거기서 나왔다.
- 저장소 자신의 레시피는 자기 경우 하나만 적으므로 분기가 필요 없다. 도구는 네이티브 파일을 문서에 적힌 대로 읽는다.
- 예제는 작동하는 방법을 전하되 누구도 거기에 묶지 않는다.
- 레시피를 검사하는 기능은 kit이 저장소 위에 정하는 새 규칙이 되고, 그것은 다시 같은 강제다.

## kit에 대한 결과

kit은 자기가 강제하는 것을 지운다. 각 변경은 Red, Green, 커밋을 거치는 체크리스트 행이다. 지금 강제하는 부분은 다음과 같다.
- **include되는 레시피.** K1054 전까지 저장소는 package의 `scripts/kit/kit.mk`와 `scripts/kit/kit-bootstrap.mk` 레시피 한 벌을 include했고, AGENTS.md는 그들을 위해 kit.mk의 모든 레시피의 mise 환경을 적었다. 이제 package는 make 파일을 싣지 않는다. kit.mk는 kit 자신의 Makefile의 레시피이고, bootstrap은 예시 `docs/examples/bootstrap.mk`이며, toolchain-lock 레시피는 UV_PYTHON을 적지 않고 `mise.toml`의 `[env]`가 정한다.
- **유틸리티 안의 덮어쓰기.** `bootstrap/install-mise.mts`(`miseEnvironment`)와 `mise-tools.mts`(`toolsEnvironment`)는 K1048 전까지 자기가 실행하는 도구에 mise와 uv의 설정(`MISE_LOCKED`, `MISE_AUTO_INSTALL`, `UV_*`, `UV_PYTHON`)을 넣었고, `link.mts`와 `run-tests.mts`는 K1049 전까지 `CARGO_TARGET_DIR`를 지웠다. K1050 전까지 lint 유틸리티는 각 도구를 저장소 자신의 설정 대신 kit의 설정으로 실행했다. golangci-lint는 kit의 `.golangci.yml`로, phpcs는 kit의 `phpcs.xml.dist`로, ruff는 kit의 `ruff.toml`로, clippy는 kit을 가리키는 `CLIPPY_CONF_DIR`로, oxlint와 knip은 kit의 `.oxlintrc.json`과 `knip.json`으로 실행한다.
- **저장소의 레시피와 workflow에 대한 검사.** K1051 전까지 kit-check는 레시피가 도구를 실행하는 방식(`recipe-tools.mts`), Makefile과 workflow의 링크 단계(S11), ci.yml의 모양과 마지막 `ci-passed` job(S12), Makefile의 `$(KIT)/<name>`(S15), manifest 경로(P30)를 판정했고, bypass-check는 Makefile과 스크립트를 판정했다. 이제 kit-check는 kit 자신의 schema가 있는 config 파일만 검증한다.
- **복사본.** K1052 전까지 kit-sync는 kit package.json의 `kit.copies` 항목 전부를 모든 저장소에 썼다. `PRINCIPLES.md`와 그 짝, `ci-pipeline.yml`, `release.yml`, bootstrap action, `config/layout.kit.yml`, `config/` 아래의 스키마, `.editorconfig`, `.claude/settings.json`이 그 안에 들었다. kit-inject-check가 바뀐 복사본을 실패시켰으므로, 복사본 파이프라인의 마지막 `required` job은 모든 저장소를 `kit-gates-*` gate를 포함한 파이프라인의 모든 job 결과에 묶었다. 이제 package는 이 파일을 예시로 담는다. 저장소는 원하는 것을 복사해 각 사본을 자기 것으로 가지며, 그 파이프라인과 그 job도 마찬가지다. kit은 어느 것도 쓰거나 비교하지 않는다. 그 파일에 대한 kit.owners의 owner 규칙, lint-ts와 rebuild-check의 사본 제외, 사본 편집에 대한 claude-hook의 거부, layout 규칙 `lint-cargo-lints`와 `config/cargo.schema.json`도 함께 사라졌다.
- **거부.**
  - `.claude/settings.json`의 Claude hook(`claude-hook.mts`)은 모든 저장소의 세션에서 명령을 거부한다.
  - `make hooks`가 쓰는 git hook은 커밋을 거부한다. commit-msg hook과 staged-generated hook이며, `commit` target도 이것들을 실행한다.
  - FINAL_RUN의 `ci-targets`는 열린 체크리스트 항목이 있는 트리를 거부한다.
  - `land`는 정적 gate가 실패하는 branch를 거부하고, 자기가 고정한 gate가 저장소 `kit-gates`의 선행 조건에 들어 있기를 요구한다.
  - `item-state`는 changelog 줄 없는 완료를 거부한다.
  - `ci-setup`은 `kit-ci-setup`을 다시 실행하는 설정 target을 거부한다.
- **규칙 문장.** 이 검사들을 적는 PRINCIPLES의 `Enforced by:` 줄(S11, S12, S13, S15 등)은 삭제와 함께 바뀌므로, 배포되는 PRINCIPLES는 kit이 더는 강제하지 않는 검사를 주장하지 않는다.

작동하는 부분은 kit에서 지우는 바로 그 변경에서 `docs/examples/`의 예제가 된다. 삭제는 kit의 새 패치 릴리즈로 나간다. 저장소는 자기가 설치하는 kit 릴리즈를 고정하므로, 새 릴리즈를 받을 때까지 지금 릴리즈를 유지하고, 받을 때 예제를 보고 자기 레시피를 쓴다.
