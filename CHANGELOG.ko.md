# 변경 기록

[English](CHANGELOG.md)

## Unreleased

- kit은 npm package `@polyspec/kit`입니다. 저장소는 `make install-tools TOOLS=npm`과 `make install-packages`로 이를 설치하고, `scripts/kit/kit-bootstrap.mk`를 include하며, `kit.copies`의 파일만 사본으로 둡니다. `make kit-sync`가 설치된 package에서 이를 쓰고, `make kit-check`가 package-lock.json의 버전에 묶습니다(K71-2).
