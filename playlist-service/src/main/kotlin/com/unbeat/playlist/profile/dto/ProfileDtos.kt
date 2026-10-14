package com.unbeat.playlist.profile.dto

import com.fasterxml.jackson.annotation.JsonProperty
import com.unbeat.playlist.userplaylist.dto.PublicPlaylistResponse

// PlaylistVisibilityRequest와 같은 이유(Kotlin 단일 프로퍼티 데이터 클래스의 Jackson
// creator-detection 버그, [[학습노트 89번]])로 혹시 몰라 @get/@param을 명시적으로 고정해둠 —
// 이쪽은 프로퍼티명이 "is"로 시작하지 않아 실제로는 문제가 재현되지 않지만, 같은 패턴의
// 단일 파라미터 요청 DTO라 방어적으로 통일함.
data class SetNicknameRequest(
    @get:JsonProperty("nickname")
    @param:JsonProperty("nickname")
    val nickname: String
)

data class MyProfileResponse(
    val nickname: String?
)

data class NicknameResponse(
    val nickname: String
)

data class UserProfilePageResponse(
    val nickname: String,
    val playlists: List<PublicPlaylistResponse>
)
