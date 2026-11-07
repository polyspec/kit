<!-- doc-id: adoption -->
<!-- source-sha256: 7a83e432220aeaa5fcfcb45edbb994becfe7721bd5d6c6c982a9ccfcb309a6af -->
# kit을 채택한 저장소에서 일하기

[English](adoption.md)

kit을 쓰는 저장소에서 일하는 agent나 사람의 절차이며, 그 바탕이 되는 규칙은 [PRINCIPLES.md](../../PRINCIPLES.ko.md)에 있다. 이
문서는 자기 규칙을 두지 않는다. 각 단계가 규칙과 그것을 지키는 도구를 가리킨다.

## item 경계마다

1. 저장소가 link로 쓰는 각 provider는 자기 target으로 build한다([local-links.ko.md](local-links.ko.md)); link는 아무것도
   build하지 않는다(K856).
2. `make install-tools`가 `mise.toml`의 도구를 설치한다.
3. `kit-gates`의 모든 gate를 실행한다. 실패한 gate는 그 저장소 plan의 다음 item이며 자기 red와 green을 가진다.
4. 매 push 전에 `make kit-gates-static`이 저장소의 자가진단이다. 실패가 있어도 모든 shared gate를 실행하므로 한 번의 실행이
   실패한 gate를 각각 적고, 모두 통과하면 `[kit-gates-static] every shared gate passed`로 끝난다. 그 `kit-check`가 규칙 S11,
   S12, P30을 판정한다. checkout의 root에서 도는 CI pipeline 하나, package manager의 link 단계 없음, 저장소 밖 경로를 적은
   추적 manifest 없음이다(K998). 테스트는 CI에서 실행한다.

## 범위

- contract 동작은 모든 구현에 있고(S6, S10) test와 함께 구현한다(P32).
- 언어나 runtime에 고유한 통합은 `docs/spec`에 중립적인 규칙 하나로 쓰고, 각 구현이 자기 고유한 형태를 묶는다(P32).
- 한 구현의 내부 test는 어떤 parity unit도 부르지 않고 requirement도 인용하지 않는 보통의 package test이며, 우연히 public인
  symbol은 non-public이 된다(P32).
- 작업에 필요한데 `docs/spec`에 없는 규칙은 거기에 먼저 쓴다. unit을 버리지 않고, test 없이 requirement를 인용하지 않으며, 검사를
  피하려고 이름을 바꾸지 않는다(P33).
- 반복된 code는 재구성하고, tool source는 분류하며, 생성물은 추적하지 않는다. 다만 consumer가 tagged tree로 설치하는 생성 source는 `config/generated.json`에 선언하고 추적한다(P34).

## Provider

저장소는 다른 저장소를 link로만 쓴다(P30). release 때문에 막힌 것처럼 보이는 finding은 link tooling의 결함이며 파일과 줄을 적어 kit
결함으로 보고한다(P35). 커밋된 lock의 재resolve만 release 결정을 기다린다. 모든 저장소의 개발이 끝나기 전에는 tag, 버전 올림,
release workflow 실행을 하지 않는다([local-links.ko.md](local-links.ko.md)).

## 질문

conductor에게 묻는 것은 kit의 결함(파일과 줄을 적어서)이나 서로 모순되는 두 규칙뿐이다(P23). 없는 규칙은 kit에서 먼저 만든다.

## 레시피 (K1054)

kit은 저장소에 레시피를 include시키지 않으며, package는 make 파일을 싣지 않는다. 저장소는 자기가 실행하는 target을 자기 경우의
변수, 설정, 환경과 함께 자기 Makefile에 쓴다. [docs/examples/bootstrap.mk](../examples/bootstrap.mk)가 한 가지 방법을 보인다.
저장소가 원하는 kit의 `scripts/kit/kit.mk` target 사본 곁에 그 사본을 두면, 설치된 package의 dist에서 도구를 실행한다.

## mise.toml의 npm 채택 (K938)

저장소는 npm을 `mise.toml`에서 가져오고 `mise.lock`에 잠그며, 같은 version을 `package.json`에 선언한다. `packageManager` 필드는
두지 않는다. 각 단계는 그것을 검사하는 도구를 가리킨다.

1. `package.json`: `packageManager`를 `"devEngines": {"packageManager": {"name": "npm", "version": "12.2.0", "onFail": "error"}}`로
   바꾼다. version은 npm 자신이 강제한다.
2. `mise.toml`: `[tools]`에 `node`와 `"npm:npm" = "12.2.0"`을 선언한다.
3. `make toolchain-lock`(온라인)이 `npm:npm`의 digest를 `mise.lock`에 쓰고, `mise.lock`이 이름하는 sidecar
   `.mise/locks/npm-npm/<version>/`(`aube-lock.yaml`과 `package.json`)를 쓴다. 이 모두를 커밋한다. sidecar가 없으면
   `mise install --locked`가 실패하므로(K192) 손으로 고치지 않는다.
4. workflow: `packageManager`를 읽는 각 줄은 대신 `devEngines.packageManager.version`을 읽는다. `npm exec`의 npm은 checkout 밖에서
   실행한다. 기계의 npm은 devEngines가 다른 version을 이름하는 폴더에서 실행을 거부하기 때문이다(EBADDEVENGINES). 줄은
   `workflows/release.yml`의 bootstrap 단계와 같은 다음 블록을 쓴다.

   ```sh
   root="$PWD"
   version="$(node -p 'require("./package.json").devEngines.packageManager.version')"
   (cd "${RUNNER_TEMP:?RUNNER_TEMP is not set}" && npm_config_cache="$root/var/bootstrap/npm-cache" npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts)
   ```

   npm은 이 npm ci에서 저장소 자신의 `.npmrc`를 읽는다. kit이나 다른 패키지를 release URL로 고정하는 저장소는 거기에
   `allow-remote=root`(또는 `all`)를 적는다. [docs/examples/native-settings](../examples/native-settings.ko.md)가 그 예를 보여 준다. kit은 아무것도 설정하지 않는다(K1045).
5. `node_modules`가 없는 checkout에는 레시피가 실행할 도구의 kit이 없다. worktree는 `make worktree-setup NAME=<name> ID=<id>`로 만들며, 이는 위의
   npm ci를 실행한 뒤 거기서 `make install`과 `make link-check`를 실행한다(K858). devEngines npm을 선언하지 않은 `package.json`은
   worktree나 branch를 만들기 전에, 그리고 npm이나 make를 실행하기 전에 거부한다(K938-1). 일반 clone은 checkout 밖에서 같은 npm ci를 먼저 실행한다.

첫 채택의 순서는 다음과 같다(K938-1).

- `package.json`과 `mise.toml`(1, 2단계), 그다음 `--prefix`를 쓰는 npm ci(4단계).
- `make install-tools TOOLS=npm`: 첫 실행은 mise를 설치한 뒤 멈춘다. mise.lock이 아직 node와 npm:npm을 고정하지 않으므로
  bootstrap이 `make toolchain-lock`을 이름한다. 기대한 동작이며 고칠 것이 없다.
- `make toolchain-lock`은 `mise.lock`과 sidecar를 쓴다. bootstrap의 `var/tools/bin/mise`와, 저장소의 레시피가 도구를
  실행하는 `node_modules` 안의 kit이 필요하다.
- `make install-tools TOOLS=npm`은 lock이 고정한 node와 npm:npm을 설치한다.
- `make install`은 나머지를 설치한다.

그다음 `package.json`, `mise.toml`, `mise.lock`, `.mise/locks/npm-npm/<version>/`과 workflow 줄을 한 변경으로 커밋한다.

## 공유 파일 (K1052)

kit은 저장소의 파일을 쓰지 않는다. workflow, bootstrap action, layout 규칙, 원칙은 package의 예시이며
[docs/examples/shared-files](../examples/shared-files.ko.md)에 목록이 있다. 저장소는 원하는 것을 복사해 각 사본을 자기 파일로
commit한다. kit-sync의 사본을 가진 저장소는 그것을 자기 파일로 그대로 두고, 자기 레시피와 workflow에서 `kit-sync`와
`kit-inject-check`를 지운다.

rules-check는 복사한 pipeline을 저장소의 workflow 중 하나로서 step의 make 명령으로 읽는다(K1057). config/ci.json의 target이나
계산된 matrix의 runtime처럼 예시 pipeline이 표현식으로만 실행하는 검사는 step이 그것을 적거나, matrix가 그 값을 나열하거나,
`Enforced by` 줄이 step이 실행하는 target을 적을 때 도달한다.

## commit의 hook과 검사 (K1053)

kit은 Git hook도 Claude Code 설정도 쓰지 않으며, kit의 어떤 유틸리티도 commit, 명령, 실행 장소를 거부하지 않는다. commit 때
검사를 원하는 저장소는 `.githooks` 아래에 자기 hook을 쓰고, `config/checklist.json`의 `hooks`에 나열하고, `make hooks`를
실행한다. [docs/examples/git-hooks](../examples/git-hooks.ko.md)가 kit의 검사를 실행하는 hook을 보여 준다. 이전 kit의
`.githooks/pre-commit`과 `.githooks/commit-msg`가 checkout에 있는 저장소는 그것을 지우거나 자기 hook으로 나열한다.

## 하지 않는 것

polling loop, 미루기, 전체 suite 실행, push, tag, release를 하지 않고, plan, item, commit에는 kit의 utility만 쓴다(P18, P24~P28, P31).
