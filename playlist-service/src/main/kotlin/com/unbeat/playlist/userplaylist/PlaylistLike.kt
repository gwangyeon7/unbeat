package com.unbeat.playlist.userplaylist

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime

/**
 * 게이미피케이션 3단계(2026-10-10 추가) — 랭킹 피드 카드에 등수 배지(금/은/동)를 넣어봤다가
 * "짜치다"는 반응으로 빼고, 좋아요 하트 숫자만 남기기로 함. 즉 "랭킹"의 실제 기준이 이 테이블의
 * 집계(좋아요 수)가 됨 — 정렬도 이 숫자로 함(PlaylistService.listPublic 참고).
 *
 * userId는 Supabase UUID 필수(세션 기반 비로그인 좋아요는 허용 안 함) — "같은 사람이 두 번
 * 좋아요 누르는 걸 막으려면" 세션이 아니라 안정적인 사용자 식별이 필요하기 때문
 * ([[학습노트 89번]]에서 이미 정한 전제와 동일 — 공개 전환/닉네임과 같은 이유).
 * (playlistId, userId) unique로 중복 좋아요를 DB 레벨에서도 막음(서비스 레이어에서도
 * existsBy로 먼저 걸러서 멱등 처리하지만, 방어적으로 한 번 더).
 */
@Entity
@Table(
    name = "playlist_likes",
    uniqueConstraints = [UniqueConstraint(columnNames = ["playlist_id", "user_id"])]
)
class PlaylistLike(
    @Column(name = "playlist_id", nullable = false)
    val playlistId: Long,

    @Column(name = "user_id", nullable = false, length = 64)
    val userId: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
