package com.unbeat.playlist.auth

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.source.JWKSource
import com.nimbusds.jose.jwk.source.RemoteJWKSet
import com.nimbusds.jose.proc.JWSVerificationKeySelector
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jose.util.DefaultResourceRetriever
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.URI

/**
 * Supabase 로그인(JWT) 검증 — backend/auth.py(FastAPI)와 같은 역할을 하는 Kotlin판.
 * 게이미피케이션(좋아요/랭킹)이 "누가" 좋아요를 눌렀는지 session_id가 아니라 안정적인
 * UUID로 식별해야 해서 먼저 필요해진 것 — 지금까지 이 서비스(playlist-service)는 즐겨찾기/
 * 재생목록 전부 X-Session-Id만으로 처리해왔고 로그인 개념이 전혀 없었음.
 *
 * 로그인은 선택 기능 — 기존 session_id 기반 흐름은 그대로 두고, 로그인한 요청에서만
 * "Authorization: Bearer <access_token>" 헤더가 추가로 들어옴. 그래서 여기 함수는 토큰이
 * 없거나 검증에 실패해도 예외를 던지지 않고 null을 반환해서, 호출하는 쪽이 "비로그인으로
 * 취급하고 계속 진행"할지 "이 엔드포인트는 로그인 필수라 403"으로 할지 직접 정하게 함
 * (backend/auth.py와 동일한 설계 — 선택적 인증이라 검증 실패를 예외로 던지지 않음).
 *
 * 검증 방식(JWKS, 공개키 기반): Supabase JWT 서명 키가 ECC(P-256, ES256) 비대칭키라서
 * (backend/auth.py와 동일하게 2026-10-07 대시보드에서 확인된 값), 백엔드에 비밀값을 저장할
 * 필요가 없음 — Supabase가 공개하는 JWKS 엔드포인트에서 검증용 공개키를 가져와 서명만
 * 확인하면 됨. RemoteJWKSet이 이 공개키를 내부적으로 캐싱해줘서(PyJWKClient와 동일한 역할)
 * 매 요청마다 네트워크 호출이 일어나지 않음.
 */
@Component
class SupabaseAuth(
    // SUPABASE_URL이 비어있으면(배포 환경변수를 아직 안 올렸거나 로컬에서 안 쓰는 경우)
    // processor를 아예 안 만들고 getUserId가 항상 null을 반환 — 로그인이 선택 기능이라
    // 이 설정이 없어도 서비스 전체가 죽으면 안 됨(backend/auth.py와 동일한 안전장치).
    @Value("\${supabase.url}") private val supabaseUrl: String
) {
    private val processor: DefaultJWTProcessor<SecurityContext>? = buildProcessor()

    private fun buildProcessor(): DefaultJWTProcessor<SecurityContext>? {
        if (supabaseUrl.isBlank()) return null
        val jwksUrl = URI("${supabaseUrl.trimEnd('/')}/auth/v1/.well-known/jwks.json").toURL()
        // (2026-10-25) RemoteJWKSet의 기본 연결/읽기 타임아웃이 0.25초라, Render 무료 인스턴스처럼 느린
        // 환경에선 Supabase 공개키(JWKS)를 못 받아와서("Read timed out") 로그인한 요청도 전부 비로그인으로
        // 처리됐음 — 공개 전환이 403이 되어 로그인 창이 반복되던 원인. 타임아웃을 5초로 늘림.
        val retriever = DefaultResourceRetriever(5000, 5000, 51200)
        val jwkSource: JWKSource<SecurityContext> = RemoteJWKSet(jwksUrl, retriever)
        // 코틀린의 자바 getter/setter -> 프로퍼티 자동 변환은 JWS/JWT처럼 약어가 섞인 이름에서
        // 대문자 처리가 꼬일 수 있어서(예: setJWSKeySelector가 프로퍼티로 잡힐 때 이름이
        // 예상과 다르게 생성됨), 혼동 없이 자바 세터 메서드를 명시적으로 그대로 호출함.
        return DefaultJWTProcessor<SecurityContext>().apply {
            setJWSKeySelector(JWSVerificationKeySelector(JWSAlgorithm.ES256, jwkSource))
            // audience가 "authenticated"인지 + exp/nbf(토큰 만료) + sub 존재를 함께 검증.
            // Supabase 발급 JWT는 항상 audience="authenticated"로 내려줌(FastAPI 쪽 검증과 동일 기준).
            setJWTClaimsSetVerifier(
                DefaultJWTClaimsVerifier<SecurityContext>(
                    JWTClaimsSet.Builder().audience("authenticated").build(),
                    setOf("sub", "exp")
                )
            )
        }
    }

    /**
     * "Authorization: Bearer <jwt>" 헤더를 검증해서 Supabase user UUID(sub claim)를 반환.
     * 헤더가 없거나, 형식이 틀리거나, 서명/만료/audience 검증에 실패하면 전부 null —
     * 호출하는 쪽에서 "로그인 안 한 것"과 동일하게 다루면 됨.
     */
    fun getUserId(authorizationHeader: String?): String? {
        if (authorizationHeader == null || processor == null) return null
        if (!authorizationHeader.startsWith("Bearer ", ignoreCase = true)) return null
        val token = authorizationHeader.substring(7).trim()
        if (token.isBlank()) return null
        return try {
            processor.process(token, null).subject
        } catch (e: Exception) {
            println("[auth] JWT 검증 실패(비로그인으로 취급): ${e.message}")
            null
        }
    }
}
