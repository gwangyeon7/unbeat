# 자동 수집 소스 점검 (2026-11-18)

build_catalog.py 실행 시 자동 생성되는 파일. 상태/응답 시간은 그날 처음 호출했을 때 값(이후엔 스냅샷 재사용).

| 소스 | HTTP 상태 | 받은 곡 | 영상 제목형 제외 | 남은 곡 | 한글 제목 | 한글 아티스트 | 응답 시간 | 비고 |
|---|---|---|---|---|---|---|---|---|
| apple | 200 | 100 | 0 | 100 | 35 | 67 | 2.14s | 시도 1회 |
| lastfm | 200 | 100 | 0 | 100 | 6 | 3 | 0.41s | country="korea, republic of" ("south korea"는 400: country param invalid) |
| youtube | 200 | 30 | 3 | 27 | 2 | 0 | 0.3s | 음악 카테고리 1회(쿼터 1유닛), 겹침 신호로만 사용 |

## 소스별 샘플 5개

- **apple**: 아일릿 - 체포하겠어 / A2O & A2O LITE - NEON / 리센느 - With / 베스티 - Love Options / Crush - 삐그덕 (feat. 아이유)
- **lastfm**: A2O LITE - NEON / ILLIT - 체포하겠어 / RESCENE - WITH / ADÉLA - Nicole Kidman / aespa - Lemonade
- **youtube**: RESCENE - With / RESCENE - Inside Out / D.O. - Darling / RESCENE - Finest Thing / LEE MU JIN - Night Stage

## 제외된 영상 제목형 예시

- youtube: Crush - 삐그덕 Live with 조이
- youtube: HYBE LABELS - ENHYPEN 'I Want You' Official MV
- youtube: 정승환 Jung Seung Hwan - 정승환 '무제 ' Cover | SeungTUDIO

## 병합 결과

- 누적 자동 수집 항목 227개 중 기존/새 아티스트에 매칭 147개, 매칭 안 됨 80개
- 새로 추가된 곡 16개, 새로 만든 아티스트 4명, 유튜브에만 나와 제외한 곡 6개
- 2개 이상 소스에 겹친 곡 28개(3개 모두 5개)
- 최종 별칭표: 아티스트 246명, 곡 2531곡, 모호 별칭 2개
- 이번 실행 외부 호출: 소스 HTTP 0회(Last.fm 0회), 유튜브 쿼터 0유닛

겹친 곡 예시: aespa - LEMONADE (apple+lastfm); aespa - Whiplash (apple+lastfm); ATEEZ - BAD (apple+lastfm); ATEEZ - UP (apple+youtube); CORTIS - REDRED (apple+lastfm); Hearts2Hearts - FOCUS (apple+lastfm); Hearts2Hearts - Moonride (apple+lastfm); Hearts2Hearts - RUDE! (apple+lastfm)

매칭 안 된 항목 예시(영문만 있는 새 아티스트 등): apple: ADÉLA - Nicole Kidman; apple: Ariana Grande - hate that i made you love me; apple: Justin Bieber - Beauty and a Beat (feat. Nicki Minaj); apple: LNGSHOT - Bananas; apple: Mariah Carey - All I Want for Christmas Is You; apple: Wham! - Last Christmas (Single Version); apple: 팀 - 사랑한 만큼; apple: 팀 - 사랑합니다...

## 번역 제목 중복 의심 아티스트 37명 (자동 판정 아님 — 건드리지 않음)

형식: 아티스트: 매칭 안 된 한글 제목 ↔ 근거 없는 영문 문장형 제목(각 최대 3개)

- 십센치: 너에게 닿기를, 그라데이션, 스토커 ↔ But it's Destiny, Tell Me It's Not a Dream, Sleepless in Seoul (Feat. LEE SUHYUN)
- ASH ISLAND: 악몽 ↔ A STAR IS BORN
- 베이비몬스터: 춤 (CHOOM) ↔ She Comes Alive, Ultra Violence and Beethoven, The Fear of Charlie Sunrise
- 블랙핑크: 뛰어(JUMP) ↔ How You Like That, Kill This Love, As If It's Your Last
- 보이넥스트도어: 오늘만 I LOVE YOU ↔ Earth, Wind & Fire, One and Only, But I Like You
- 방탄소년단: 봄날 ↔ I NEED U, NO MORE DREAM, LET ME KNOW
- can't be blue: 사랑이라 했던 말 속에서 ↔ Should be you, take it anymore, still want me to love you
- 치즈: 이렇게 좋아해 본 적이 없어요 ↔ How Do You Think, Little by little, Never Loved This Way Before
- 크러쉬: 삐그덕 (Feat. 아이유), 미워 ↔ A Little Bit (feat. Lydia Paek), Whatever You Do (feat. Gray), Give It To Me (feat. Jay Park, Simon Dominic)
- DANIEL: 은방울 ↔ Lily of the Valley, Hi Bye, Goodnight, Estou apaixonado - ao vivo
- 이클립스: 소나기 ↔ Welcome To My Crib, Viva La Victoria, YITTY ON YO TITTIES
- 엑소: 첫 눈 ↔ CALL ME BABY, Let Out The Beast
- 거니: 같애 (Feat. SHIRT) ↔ Once a Day, Secret of Ours, Comes and Goes
- 갓세븐: 하지하지마 ↔ You Calling My Name, If You Do, NOT BY THE MOON
- 아이콘: 사랑을 했다 (LOVE SCENARIO) ↔ Long Time No See
- 진영: 외사랑 (feat. 최유리) ↔ Shining on Your Night, You Are the Apple of My Eye (From "You Are the Apple of My Eye" [Original Television Soundtrack], Pt.2)
- 주시크: 너를 생각해 ↔ Baby I Need You, Think About You, Call Your Name
- 릴러말즈: 거리에서 (Feat. ASH ISLAND) ↔ Don′t do That, On the street (Feat. ASH ISLAND), OUT OF MY SIGHT
- 임영웅: 또또, 순간을 영원처럼 ↔ Do Or Die, If We Ever Meet Again, Our Blues, Our Life
- 마크툽: 시작의 아이 ↔ To You My Light (feat. Lee Raon), The Eternal Moment, Ode To The Stars
- 너드커넥션: 조용히 완전히 영원히 ↔ Silently Completely Eternally, Good Night Good Dream, Will We Be a Melody
- Panda Gomm: 화, 목 ↔ KILL YOUR DARLINGS (feat. jeebanoff, OBSN), and I love it (Feat. Summer Soul, Junggigo)
- 파테코: 보고 싶어질 때면 ↔ Think About You, LOVE or COOL, Come To Me
- PLAVE: 이 밤을 빌려 말해요, 푸른 하늘에 단비 ↔ Wait for you, Watch Me Woo!, Pump Up The Volume!
- 싸이: 어땠을까 (Feat. 박정현), 예술이야, 뜨거운 안녕 (Feat. 성시경) ↔ I Luv It
- 리도어: 영원은 그렇듯 ↔ Forever Has Always Been, What can I do? That′s what my heart says, My blue wavy room
- 리센느: 백화요란 (Inside Out) ↔ In my lotion
- 산이: 한여름밤의 꿈 ↔ Story Of Someone I Know
- 태연: 만찬가 ↔ I Got Love
- 투어스: 첫 만남은 계획대로 되지 않아 ↔ If I’m S, Can You Be My N?, Oh Mymy : 7s
- 우디: 어제보다 슬픈 오늘 ↔ when you leave, Nothing's gonna be changed, Queer Eye For The Straight Guy
- YOASOBI: たぶん (아마도, Tabun) ↔ Into The Night
- 검정치마: 한시 오분 (1:05), 나랑 아니면, 폭죽과 풍선들 ↔ Kiss and Tell
- 그_냥: 우리 사랑은 필름 같았으면 해요 ↔ How's your night, Way Back Home, I Want to Be A Pillow
- 로이킴: 내게 사랑이 뭐냐고 물어본다면 ↔ Love Love Love
- 방쏭: 내가 더 사랑한단 이유로 ↔ an easy task (with hunhunhada)
- 우효: 민들레 (single ver.) ↔ Teddy Bear Rises, A Good Day
