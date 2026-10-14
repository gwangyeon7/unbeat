package com.unbeat.playlist.userplaylist

import org.springframework.data.jpa.repository.JpaRepository

interface PlaylistTrackRepository : JpaRepository<PlaylistTrack, Long> {
    fun findByPlaylistIdOrderByAddedAtDesc(playlistId: Long): List<PlaylistTrack>
    fun findByPlaylistIdAndArtistNameAndTrackName(
        playlistId: Long,
        artistName: String,
        trackName: String
    ): PlaylistTrack?
    fun countByPlaylistId(playlistId: Long): Long
    fun deleteByPlaylistId(playlistId: Long)

    // (게이미피케이션 2.5단계, 랭킹 피드 카드 디자인) 공개 피드 카드에 쓸 "대표 커버 이미지" —
    // 이미지가 있는 곡 중 가장 최근에 담긴 걸 고름(이미지 없는 곡이 먼저 담겼다고 빈 카드가
    // 뜨는 걸 피하려고 imageUrl IS NOT NULL 조건을 넣음). Spring Data의 findFirst...By 파생
    // 쿼리로 LIMIT 1을 그대로 표현.
    fun findFirstByPlaylistIdAndImageUrlIsNotNullOrderByAddedAtDesc(playlistId: Long): PlaylistTrack?
}
