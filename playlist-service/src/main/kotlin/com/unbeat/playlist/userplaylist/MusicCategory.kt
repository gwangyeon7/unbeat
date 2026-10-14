package com.unbeat.playlist.userplaylist

/**
 * 랭킹 피드 카테고리(2026-10-10 추가) — "랭킹 집계할 때 카테고리(일본 OST, 발라드 등)가
 * 있었으면 좋겠다"는 요청으로 추가. 재생목록 "만들 때"는 장벽이 생기면 안 된다고 판단해서
 * (닉네임과 같은 논리 — [[학습노트 90번]]), 카테고리도 "공개로 전환할 때"만 선택하게 함
 * (PlaylistService.setVisibility 참고).
 *
 * 자유 입력을 안 받고 고정 목록에서만 고르게 하는 이유 — "발라드"/"Ballad"/"발라드곡"처럼
 * 표기가 흩어지면 필터링 자체가 무의미해짐. AutoPlaylistService의 장르 분류(GENRE_LABELS)와
 * 비슷하지만 의도적으로 분리된 목록 — 저쪽은 Last.fm 태그 매칭용이고 이쪽은 사용자가 직접
 * 고르는 UI용이라 값이 꼭 같을 필요는 없음(그래서 중복이지만 각자 독립적으로 유지).
 */
val MUSIC_CATEGORIES: Map<String, String> = linkedMapOf(
    "kpop" to "케이팝",
    "ballad" to "발라드",
    "hiphop" to "힙합",
    "rnb" to "알앤비",
    "rock" to "록",
    "pop" to "팝",
    "indie" to "인디",
    "electronic" to "일렉트로닉",
    "acoustic" to "어쿠스틱",
    "jazz" to "재즈",
    "classical" to "클래식",
    "ost" to "OST",
    "etc" to "기타"
)
