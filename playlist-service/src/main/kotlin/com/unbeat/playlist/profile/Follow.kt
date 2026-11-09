package com.unbeat.playlist.profile

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime

/**
 * 팔로우(2026-10-29, 랭킹/소셜 C단계). 좋아요(PlaylistLike)와 같은 이유로 Supabase UUID 기준 —
 * 로그인한 사용자끼리만 팔로우 가능. (follower, followee) unique로 중복 팔로우를 DB에서도 막음.
 */
@Entity
@Table(
    name = "follows",
    uniqueConstraints = [UniqueConstraint(columnNames = ["follower_id", "followee_id"])]
)
class Follow(
    @Column(name = "follower_id", nullable = false, length = 64)
    val followerId: String,

    @Column(name = "followee_id", nullable = false, length = 64)
    val followeeId: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
