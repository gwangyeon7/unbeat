package com.unbeat.playlist.config

import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

@Configuration
class WebConfig : WebMvcConfigurer {
	override fun addCorsMappings(registry: CorsRegistry) {
		registry.addMapping("/**")
			.allowedOrigins("http://localhost:3000", "http://127.0.0.1:3000")
			.allowedMethods("GET", "POST", "DELETE", "OPTIONS")
			.allowedHeaders("*")
	}
}
