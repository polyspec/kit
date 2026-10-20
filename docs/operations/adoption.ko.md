<!-- doc-id: adoption -->
<!-- source-sha256: 53e287fd3a4f75a1a0ddb61002200eb6b207950a717af3f7ff66652573645e78 -->
# kit을 채택한 저장소에서 일하기

[English](adoption.md)

kit을 쓰는 저장소에서 일하는 agent나 사람의 절차이며, 그 바탕이 되는 규칙은 [PRINCIPLES.md](../../PRINCIPLES.ko.md)에 있다. 이
문서는 자기 규칙을 두지 않는다. 각 단계가 규칙과 그것을 지키는 도구를 가리킨다.

## item 경계마다

1. `make kit-sync`가 설치된 kit의 파일을 복사한다(P30: 개발 checkout의 설치된 kit은 local kit으로 가는 link이므로 kit의 landing은
   중계 없이 이렇게 저장소에 닿는다).
2. `node <kit checkout>/dist/link.mjs rebuild <repository>`가 저장소가 link로 쓰는 provider를 다시 build한다
   ([local-links.ko.md](local-links.ko.md)).
3. `make install-tools`가 `mise.toml`의 도구를 설치한다.
4. `kit-gates`의 모든 gate를 실행한다. 실패한 gate는 그 저장소 plan의 다음 item이며 자기 red와 green을 가진다.

## 범위

- contract 동작은 모든 구현에 있고(S6, S10) test와 함께 구현한다(P32).
- 언어나 runtime에 고유한 통합은 `docs/spec`에 중립적인 규칙 하나로 쓰고, 각 구현이 자기 고유한 형태를 묶는다(P32).
- 한 구현의 내부 test는 어떤 parity unit도 부르지 않고 requirement도 인용하지 않는 보통의 package test이며, 우연히 public인
  symbol은 non-public이 된다(P32).
- 작업에 필요한데 `docs/spec`에 없는 규칙은 거기에 먼저 쓴다. unit을 버리지 않고, test 없이 requirement를 인용하지 않으며, 검사를
  피하려고 이름을 바꾸지 않는다(P33).
- 반복된 code는 재구성하고, tool source는 분류하며, 생성물은 추적하지 않는다(P34).

## Provider

저장소는 다른 저장소를 link로만 쓴다(P30). release 때문에 막힌 것처럼 보이는 finding은 link tooling의 결함이며 파일과 줄을 적어 kit
결함으로 보고한다(P35). 커밋된 lock의 재resolve만 release 결정을 기다린다. 모든 저장소의 개발이 끝나기 전에는 tag, 버전 올림,
release workflow 실행을 하지 않는다([local-links.ko.md](local-links.ko.md)).

## 질문

conductor에게 묻는 것은 kit의 결함(파일과 줄을 적어서)이나 서로 모순되는 두 규칙뿐이다(P23). 없는 규칙은 kit에서 먼저 만든다.

## 하지 않는 것

polling loop, 미루기, 전체 suite 실행, push, tag, release를 하지 않고, plan, item, commit에는 kit의 utility만 쓴다(P18, P24~P28, P31).
