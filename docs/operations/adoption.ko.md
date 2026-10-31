<!-- doc-id: adoption -->
<!-- source-sha256: bd25f02a76cb7352310f0c9e849845b008ea262d426dfc28bfd07ef214b70f6e -->
# kit을 채택한 저장소에서 일하기

[English](adoption.md)

kit을 쓰는 저장소에서 일하는 agent나 사람의 절차이며, 그 바탕이 되는 규칙은 [PRINCIPLES.md](../../PRINCIPLES.ko.md)에 있다. 이
문서는 자기 규칙을 두지 않는다. 각 단계가 규칙과 그것을 지키는 도구를 가리킨다.

## item 경계마다

1. `make kit-sync`가 설치된 kit의 파일을 복사한다(P30: 개발 checkout의 설치된 kit은 local kit으로 가는 link이므로 kit의 landing은
   중계 없이 이렇게 저장소에 닿는다).
2. 저장소가 link로 쓰는 각 provider는 자기 target으로 build한다([local-links.ko.md](local-links.ko.md)); link는 아무것도
   build하지 않는다(K856).
3. `make install-tools`가 `mise.toml`의 도구를 설치한다.
4. `kit-gates`의 모든 gate를 실행한다. 실패한 gate는 그 저장소 plan의 다음 item이며 자기 red와 green을 가진다.

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
   (cd "${RUNNER_TEMP:?RUNNER_TEMP is not set}" && npm_config_cache="$root/var/bootstrap/npm-cache" npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts --allow-remote=root)
   ```
5. `node_modules`가 없는 checkout에는 include할 kit이 없다. worktree는 `make worktree-setup NAME=<name> ID=<id>`로 만들며, 이는 위의
   npm ci를 실행한 뒤 거기서 `make install`과 `make link-check`를 실행한다(K858). devEngines npm을 선언하지 않은 `package.json`은
   worktree나 branch를 만들기 전에, 그리고 npm이나 make를 실행하기 전에 거부한다(K938-1). 일반 clone은 checkout 밖에서 같은 npm ci를 먼저 실행한다.

첫 채택의 순서는 다음과 같다(K938-1).

- `package.json`과 `mise.toml`(1, 2단계), 그다음 `--prefix`를 쓰는 npm ci(4단계).
- `make install-tools TOOLS=npm`: 첫 실행은 mise를 설치한 뒤 멈춘다. mise.lock이 아직 node와 npm:npm을 고정하지 않으므로
  bootstrap이 `make toolchain-lock`을 이름한다. 기대한 동작이며 고칠 것이 없다.
- `make toolchain-lock`은 `mise.lock`과 sidecar를 쓴다. bootstrap의 `var/tools/bin/mise`와, 레시피가 kit의 include를 거쳐
  실행되므로 `node_modules` 안의 kit이 필요하다.
- `make install-tools TOOLS=npm`은 lock이 고정한 node와 npm:npm을 설치한다.
- `make install`은 나머지를 설치한다.

그다음 `package.json`, `mise.toml`, `mise.lock`, `.mise/locks/npm-npm/<version>/`과 workflow 줄을 한 변경으로 커밋한다.

## 하지 않는 것

polling loop, 미루기, 전체 suite 실행, push, tag, release를 하지 않고, plan, item, commit에는 kit의 utility만 쓴다(P18, P24~P28, P31).
