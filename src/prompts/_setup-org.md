먼저 Organization이 있는지 확인합니다:

```bash
relay orgs list --json
```

Organization이 없으면 새로 생성합니다:

```bash
relay orgs create "조직 이름"
```

생성 후 접근 코드를 만들어 멤버를 초대할 수 있습니다:

```bash
relay grant create --org <org-slug>
```

접근 코드를 받은 멤버는 아래 명령으로 Organization에 가입합니다:

```bash
relay grant use --code <접근코드>
```

또는 웹에서 직접 관리할 수도 있습니다: relayax.com/orgs
