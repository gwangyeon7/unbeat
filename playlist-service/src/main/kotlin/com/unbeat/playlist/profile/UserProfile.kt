package com.unbeat.playlist.profile

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/**
 * 게이미피케이션 "랭킹" 신원 레이어(2026-10-10 추가). 처음엔 공개 피드에 재생목록 이름만
 * 익명으로 나열했는데, 라이브 테스트 중 "네이버 블로그처럼 닉네임을 정하고 그 닉네임을
 * 눌러서 그 사람 페이지로 들어가는 게 낫겠다"는 피드백을 받고 분리함 — 좋아요(3단계)/랭킹
 * 공식(4단계)도 결국 "재생목록 단위"가 아니라 "사람(닉네임) 단위"로 집계돼야 의미가 있어서,
 * 이 테이블이 그 집계의 기준점이 됨.
 *
 * userId는 Supabase UUID(로그인 필수 — 비로그인 session_id로는 "같은 사람"을 보장 못 해서
 * [[학습노트 89번]]에서 이미 정한 전제와 동일), 1인당 레코드 하나(unique). nickname도
 * unique — 블로그 아이디처럼 한 번 정하면 다른 사람이 못 씀(중복 체크는
 * UserProfileService.setNickname에서).
 */
@Entity
@Table(name = "user_profiles")
class UserProfile(
    @Column(name = "user_id", nullable = false, unique = true, length = 64)
    val userId: String,

    @Column(name = "nickname", nullable = false, unique = true, length = 30)
    var nickname: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
