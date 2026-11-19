package com.unbeat.playlist.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * (2026-11-19) 재생목록/즐겨찾기가 "기기(세션 ID)"에 묶여서, 같은 계정으로 로그인해도 앱을 다시 깔거나 다른 기기에서
 * 열면 안 보이고, 계정을 바꿔도 이전 계정 것이 그대로 보이던 문제 수정.
 *
 * 방식: 로그인한(유효한 Supabase JWT) 요청이면 X-Session-Id 헤더 값을 "로그인 사용자 UUID"로 바꿔서 컨트롤러에 넘김.
 * 그러면 모든 곳(재생목록·즐겨찾기·즐겨찾기 곡·오늘의 믹스)이 세션 ID 대신 계정 UUID를 소유자 키로 씀 — 컨트롤러/서비스/스키마
 * 변경 없이 계정 단위로 동작. 비로그인 요청은 지금처럼 기기 세션 ID 그대로.
 *
 * 기존 데이터 이전: 로그인 요청에서 (기기 세션 ID, 계정 UUID) 쌍을 처음 볼 때 한 번(서버가 켜져 있는 동안),
 * 그 세션 ID로 저장돼 있던 재생목록/즐겨찾기/즐겨찾기 곡의 소유자 키를 계정 UUID로 옮기고, 이 계정이 이전에 만든 재생목록
 * (user_id가 같은 것)도 같이 옮김. 같은 곡/아티스트가 이미 계정에 있으면(UNIQUE 충돌) 그 행만 건너뜀(UPDATE IGNORE).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class AccountOwnerFilter(
    private val supabaseAuth: SupabaseAuth,
    private val jdbc: JdbcTemplate
) : OncePerRequestFilter() {

    private val adopted = ConcurrentHashMap.newKeySet<String>()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain
    ) {
        val userId = supabaseAuth.getUserId(request.getHeader("Authorization"))
        val sessionId = request.getHeader(HEADER)
        if (userId == null || sessionId == null) {
            chain.doFilter(request, response)
            return
        }
        if (sessionId != userId && adopted.add("$sessionId|$userId")) {
            try {
                adopt(sessionId, userId)
            } catch (e: Exception) {
                adopted.remove("$sessionId|$userId") // 다음 요청에서 다시 시도
                println("[account] 데이터 이전 실패(무시하고 진행): ${e.message}")
            }
        }
        chain.doFilter(OwnerRequest(request, userId), response)
    }

    private fun adopt(sessionId: String, userId: String) {
        val p = jdbc.update("UPDATE playlists SET session_id = ? WHERE session_id = ? OR user_id = ?", userId, sessionId, userId)
        val f = jdbc.update("UPDATE IGNORE favorites SET session_id = ? WHERE session_id = ?", userId, sessionId)
        val t = jdbc.update("UPDATE IGNORE favorite_tracks SET session_id = ? WHERE session_id = ?", userId, sessionId)
        println("[account] 이전: 재생목록 $p, 즐겨찾기 $f, 즐겨찾기 곡 $t (세션 ${sessionId.take(8)}… -> 계정 ${userId.take(8)}…)")
    }

    private class OwnerRequest(request: HttpServletRequest, private val owner: String) : HttpServletRequestWrapper(request) {
        override fun getHeader(name: String): String? =
            if (name.equals(HEADER, ignoreCase = true)) owner else super.getHeader(name)

        override fun getHeaders(name: String): java.util.Enumeration<String> =
            if (name.equals(HEADER, ignoreCase = true)) Collections.enumeration(listOf(owner)) else super.getHeaders(name)
    }

    companion object {
        private const val HEADER = "X-Session-Id"
    }
}
