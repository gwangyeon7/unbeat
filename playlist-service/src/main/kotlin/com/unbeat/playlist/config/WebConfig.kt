package com.unbeat.playlist.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class WebConfig(
	// backend(FastAPI)의 ALLOWED_ORIGINS와 동일한 패턴 — 로컬 기본값은 코드에 고정해두고,
	// 배포 환경(Vercel 등)의 실제 프론트 도메인은 콤마로 구분된 ALLOWED_ORIGINS 환경변수로
	// 추가한다. 값이 없으면 로컬 기본값만 적용됨.
	@Value("\${ALLOWED_ORIGINS:}") private val extraOrigins: String
) : WebMvcConfigurer {
	override fun addCorsMappings(registry: CorsRegistry) {
		val defaultOrigins = arrayOf("http://localhost:3000", "http://127.0.0.1:3000")
		val parsedExtra = extraOrigins.split(",").map { it.trim() }.filter { it.isNotEmpty() }

		registry.addMapping("/**")
			.allowedOrigins(*(defaultOrigins + parsedExtra))
			.allowedMethods("GET", "POST", "DELETE", "OPTIONS")
			.allowedHeaders("*")
	}
}
