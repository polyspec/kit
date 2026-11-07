<!-- doc-id: example-native-settings -->
<!-- source-sha256: 6973ddc3efddfabbbbf9840fac0dc7cdf67e601938f6a40e20da5780702c1bfa -->
# 예제: 네이티브 설정

[English](native-settings.md)

저장소는 도구의 설정을 그 도구 자신의 파일에 적고, 각 도구는 문서에 적힌 대로 그것을 읽는다. kit은 그중 어느 것도 정하지 않는다. 이 문서는 작동하는 방법 하나를 보여 준다. 복사하거나, 바꾸거나, 무시하면 된다.

## npm: `.npmrc`

npm 12는 프로젝트가 허용하지 않으면 URL 의존성을 거부한다(`allow-remote`, 기본값 `none`). `package-lock.json`이 `@polyspec/kit`이나 다른 패키지를 release asset의 URL로 고정하는 저장소는 자기 `package.json`이 적은 URL을 허용한다.

```ini
allow-remote=root
```

자기 의존성을 URL로 적는 제공 라이브러리를 설치하는 저장소는 그것들도 허용한다.

```ini
allow-remote=all
```

npm은 모든 `npm ci`와 `npm install`에서 프로젝트 루트의 `.npmrc`를 읽는다. 다른 폴더에서 실행한 `npm --prefix <root> ci`도 마찬가지다.
