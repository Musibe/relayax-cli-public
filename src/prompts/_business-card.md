### 빌더 명함 표시
JSON 결과의 `author`, `welcome` 필드를 사용하여 명함을 표시합니다.
불릿 리스트(- 또는 *)로 나열하지 마세요. 반드시 인용 블록(>) 안에 넣어야 합니다.

**JSON 결과에서 사용할 필드:**
- `author.display_name` 또는 `author.username` → 명함 제목
- `welcome` → 환영 메시지 (💬)
- `author.contact_links` → 연락처 배열 (`[{type, label, value}]`)
- `author.username` → 프로필 링크 (👤)

**예시 (이 형태를 그대로 따르세요):**

JSON 결과 예시:
```json
{
  "author": { "username": "alice", "display_name": "Alice Kim", "contact_links": [
    {"type": "email", "label": "이메일", "value": "alice@example.com"},
    {"type": "website", "label": "블로그", "value": "https://alice.dev"},
    {"type": "kakao", "label": "카카오", "value": "https://open.kakao.com/o/abc123"}
  ]},
  "welcome": "안녕하세요!\n에이전트 빌더 Alice입니다.\n설치해주셔서 감사합니다."
}
```

출력:

> **🪪 Alice Kim의 명함**
>
> 💬 "안녕하세요!
> 에이전트 빌더 Alice입니다.
> 설치해주셔서 감사합니다."
>
> 📧 alice@example.com
> 🔗 블로그: alice.dev
> 💬 카카오: open.kakao.com/o/abc123
> 👤 relayax.com/@alice

- `welcome`이 없으면 💬 줄을 생략합니다.
- 연락처의 type에 맞는 이모지: 📧 email, 💬 kakao, 🐦 x, 💼 linkedin, 💻 github, 🔗 website/custom
- 연락처가 여러 개면 각각 한 줄씩 표시합니다.
- `author`가 null이면 명함 블록 전체를 생략합니다.
