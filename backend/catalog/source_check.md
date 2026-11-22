# 자동 수집 소스 점검 (2026-11-22)

build_catalog.py 실행 시 자동 생성되는 파일. 상태/응답 시간은 그날 처음 호출했을 때 값(이후엔 스냅샷 재사용).

| 소스 | HTTP 상태 | 받은 곡 | 영상 제목형 제외 | 남은 곡 | 한글 제목 | 한글 아티스트 | 응답 시간 | 비고 |
|---|---|---|---|---|---|---|---|---|
| apple | 200 | 100 | 0 | 100 | 36 | 66 | 2.31s | 시도 2회 |
| lastfm | 200 | 100 | 0 | 100 | 5 | 2 | 0.57s | country="korea, republic of" ("south korea"는 400: country param invalid) |
| youtube | 200 | 30 | 3 | 27 | 2 | 0 | 0.33s | 음악 카테고리 1회(쿼터 1유닛), 겹침 신호로만 사용 |

## 소스별 샘플 5개

- **apple**: 아일릿 - 체포하겠어 / A2O & A2O LITE - NEON / 리센느 - With / 베스티 - Love Options / Crush - 삐그덕 (feat. 아이유)
- **lastfm**: A2O LITE - NEON / ILLIT - 체포하겠어 / ADÉLA - Nicole Kidman / RESCENE - WITH / aespa - Lemonade
- **youtube**: BIGBANG - GiiiRIP / SOMEDAY - Do you know / YENA - Sakuranbo / RESCENE - With / RESCENE - Inside Out

## 제외된 영상 제목형 예시

- youtube: Crush - 삐그덕 Live with 조이
- youtube: 베스티 - 연애의 조건 | Suit Dance | 수트댄스 | Performance | 4K
- youtube: 래원 - 래원 '먼치킨 ' MV

## 병합 결과

- 누적 자동 수집 항목 278개 중 기존/새 아티스트에 매칭 196개, 매칭 안 됨 82개
- 새로 추가된 곡 19개, 새로 만든 아티스트 4명, 유튜브에만 나와 제외한 곡 10개
- 2개 이상 소스에 겹친 곡 39개(3개 모두 5개)
- 최종 별칭표: 아티스트 512명, 곡 5304곡, 모호 별칭 9개
- 이번 실행 외부 호출: 소스 HTTP 4회(Last.fm 1회), 유튜브 쿼터 1유닛

겹친 곡 예시: aespa - LEMONADE (apple+lastfm); aespa - Whiplash (apple+lastfm); ALLDAY PROJECT - CRASH (apple+lastfm); Ariana Grande - hate that i made you love me (apple+lastfm); ATEEZ - BAD (apple+lastfm); ATEEZ - Drip (apple+lastfm); ATEEZ - UP (apple+youtube); BIGBANG - 기립 (GiiiRIP) (apple+youtube)

매칭 안 된 항목 예시(영문만 있는 새 아티스트 등): apple: ADÉLA - Nicole Kidman; apple: Alessia Cara - Make It to Christmas; apple: Kelly Clarkson - Underneath the Tree; apple: 팀 - 사랑한 만큼; apple: 팀 - 사랑합니다...; lastfm: 2hollis - daisy; lastfm: 2hollis - Eyes wide closed; lastfm: 2hollis - human after all

## 번역 제목 중복 의심 아티스트 124명 (자동 판정 아님 — 건드리지 않음)

형식: 아티스트: 매칭 안 된 한글 제목 ↔ 근거 없는 영문 문장형 제목(각 최대 3개)

- 십센치: 너에게 닿기를, 스토커, 그라데이션 ↔ But it's Destiny, Tell Me It's Not a Dream, Sleepless in Seoul (Feat. LEE SUHYUN)
- aett: 제비꽃 ↔ DAYTIME DISCO MINI MIXTAPE # 1, NIGHT TIME DISCO MINI MIXTAPE # 2, 073 - gracias sr. salvo a mi gatito
- Ambid Jack: 인스턴트랩 ↔ Man of still (feat. DEEPFLOW), No other choice
- 에피타이저: 연애하고 싶지만 ↔ Love Is A Beautiful Thing (feat. BBAHN), love is leaving, Let's never meet again
- ASH ISLAND: 악몽 ↔ A STAR IS BORN
- 베이비몬스터: 춤 (CHOOM) ↔ She Comes Alive, Ultra Violence and Beethoven, The Fear of Charlie Sunrise
- B JYUN.: 선 넘네. (Feat. Skinny Brown) ↔ LONG TAILED TIT. (Feat. Leellamarz), BREAK THE LINE. (Feat. Skinny Brown), WELCOME TO RADIO GALAXY.
- 블랙핑크: 뛰어(JUMP) ↔ How You Like That, Kill This Love, As If It's Your Last
- 보이넥스트도어: 오늘만 I LOVE YOU ↔ Earth, Wind & Fire, One and Only, But I Like You
- 방탄소년단: 봄날, 작은 것들을 위한 시 (Boy With Luv) (Feat. Halsey), 소우주 (Mikrokosmos) ↔ NO MORE DREAM, LET ME KNOW, We Are Bulletproof PT.2
- can't be blue: 사랑이라 했던 말 속에서 ↔ Should be you, take it anymore, still want me to love you
- 치즈: 이렇게 좋아해 본 적이 없어요 ↔ How Do You Think, Little by little, Never Loved This Way Before
- 쿠잉: 유영 (游泳) ↔ ONE LAST TIME, The Milky Way, summer in summer
- 크러쉬: 삐그덕 (Feat. 아이유), 미워 ↔ A Little Bit (feat. Lydia Paek), Whatever You Do (feat. Gray), Give It To Me (feat. Jay Park, Simon Dominic)
- 다희: 좋아하니까 ↔ Because It’s Spring
- DANIEL: 은방울 ↔ Lily of the Valley, Hi Bye, Goodnight, Estou apaixonado - ao vivo
- 데이식스: 녹아내려요 ↔ Love me or Leave me
- 디멜로: 안녕한가요 ↔ C.T.P. (Come to Party) [feat. Tomie]
- 이클립스: 소나기 ↔ Welcome To My Crib, Viva La Victoria, YITTY ON YO TITTIES
- 엑소: 첫 눈, 으르렁 (Growl), 중독 (Overdose) ↔ Let Out The Beast
- 거니: 같애 (Feat. SHIRT) ↔ Once a Day, Secret of Ours, Comes and Goes
- 갓세븐: 하지하지마 ↔ You Calling My Name, If You Do, NOT BY THE MOON
- 해로이키: 평가절하의 그녀 ↔ Can't Doubt This Love, The end of a fall, My last diary
- HANZ: 홍련 ↔ I'll be okay, Leaving For Good
- 하성운: 자니, 잊지마요 (Feat. 박지훈) ↔ Think of You, I Fall in Love
- 혁기: 나만 보고싶은 ↔ Hold me like the ocean, Come to me, Vibrate in My Heart
- 휴이: 이별인가 봐 헤어지나 봐 ↔ I Just Wanna Love You, Looks like love is coming, I still love you
- HWAN: 내가 있을 시간에 머물러줘 (Prod. Tmlm) ↔ Anh Đã Quen Ở Bên Cạnh Em - Mck, A ray of sunlight, It's So Sweet
- 황지상: 11월 11일 (Feat. Koonta) ↔ One Two Hook, I can do it too! (feat. Don Mills), Purple, I′m Fine (Feat. Rredrain)
- 아이들: 나는 아픈 건 딱 질색이니까 ↔ Oh My God
- 아이콘: 사랑을 했다 (LOVE SCENARIO) ↔ Long Time No See
- iME: 세계 최강 귀요미 선언! ↔ The Prodigy - Poison (Jim Pavloff DNB Remix)
- 인피니트: 추격자, Man In Love (남자가 사랑할때), 파라다이스 (Paradise) ↔ CAN U SMILE
- 진영: 외사랑 (feat. 최유리) ↔ Shining on Your Night, You Are the Apple of My Eye (From "You Are the Apple of My Eye" [Original Television Soundtrack], Pt.2)
- 줍에이: 긴 밤 (for you) ↔ I'm in L but, Love Don't Turn Bad, I think of you
- 주시크: 너를 생각해 ↔ Baby I Need You, Think About You, Call Your Name
- 저스디스: 살짝 Freestyle (feat. Leellamarz) ↔ SUN GOES DOWN (Prod. R.Tee), That Ain't Real
- KCM: 사랑하면 ↔ An old love story, Love You To Death (Feat. Soul Dive)
- 금동현: 자꾸 생각나 (On My Mind) ↔ Het Maakt Niet Uit
- 키츠요지: 문담피 (Feat. 허성현) ↔ Swarm (Feat. Minbroskii, Dor1ki, Toru, Hijvc Kid, NY Dogg) - Flies Remix, Stand Up Remix (Feat. Blase, ChaMane, Mckdaddy, dsel, Layone, Posadic, kaogaii, Skyminhyuk), I Need It (Feat. Gist)
