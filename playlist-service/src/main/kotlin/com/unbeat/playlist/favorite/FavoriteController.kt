package com.unbeat.playlist.favorite

import com.unbeat.playlist.favorite.dto.FavoriteRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * FastAPI 쪽 main.py와 동일하게 X-Session-Id 헤더로 익명 사용자를 구분한다.
 * (언어/프레임워크는 다르지만 세션 식별 방식은 서비스 전체에서 일관되게 유지)
 */
@RestController
@RequestMapping("/favorites")
class FavoriteController(private val favoriteService: FavoriteService) {

	@GetMapping
	fun list(@RequestHeader("X-Session-Id") sessionId: String) =
		favoriteService.list(sessionId)

	@PostMapping
	fun add(
		@RequestHeader("X-Session-Id") sessionId: String,
		@RequestBody request: FavoriteRequest
	): ResponseEntity<Any> {
		val response = favoriteService.add(sessionId, request)
		return ResponseEntity.status(HttpStatus.CREATED).body(response)
	}

	@DeleteMapping("/{id}")
	fun remove(
		@RequestHeader("X-Session-Id") sessionId: String,
		@PathVariable id: Long
	): ResponseEntity<Any> {
		val removed = favoriteService.remove(sessionId, id)
		return if (removed) ResponseEntity.noContent().build()
		else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
	}
}
