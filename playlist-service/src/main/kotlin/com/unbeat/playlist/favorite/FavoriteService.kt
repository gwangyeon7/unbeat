package com.unbeat.playlist.favorite

import com.unbeat.playlist.favorite.dto.FavoriteRequest
import com.unbeat.playlist.favorite.dto.FavoriteResponse
import org.springframework.stereotype.Service
import java.time.format.DateTimeFormatter

@Service
class FavoriteService(private val favoriteRepository: FavoriteRepository) {

	fun list(sessionId: String): List<FavoriteResponse> =
		favoriteRepository.findBySessionIdOrderByCreatedAtDesc(sessionId).map { it.toResponse() }

	// 이미 즐겨찾기 되어있으면 그대로 반환 (멱등하게 처리 -> 프론트에서 중복 클릭 걱정 없이 호출 가능)
	fun add(sessionId: String, request: FavoriteRequest): FavoriteResponse {
		val existing = favoriteRepository.findBySessionIdAndArtistName(sessionId, request.artistName)
		if (existing != null) {
			return existing.toResponse()
		}
		val saved = favoriteRepository.save(
			Favorite(
				sessionId = sessionId,
				artistName = request.artistName,
				imageUrl = request.imageUrl
			)
		)
		return saved.toResponse()
	}

	// sessionId가 다르면 남의 즐겨찾기를 못 지우게 막는다 (로그인 없는 대신 최소한의 소유권 체크)
	fun remove(sessionId: String, favoriteId: Long): Boolean {
		val favorite = favoriteRepository.findById(favoriteId).orElse(null) ?: return false
		if (favorite.sessionId != sessionId) return false
		favoriteRepository.delete(favorite)
		return true
	}

	private fun Favorite.toResponse() = FavoriteResponse(
		id = id!!,
		artistName = artistName,
		imageUrl = imageUrl,
		createdAt = createdAt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
	)
}
