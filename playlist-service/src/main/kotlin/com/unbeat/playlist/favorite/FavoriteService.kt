package com.unbeat.playlist.favorite

import com.unbeat.playlist.favorite.dto.FavoriteRequest
import com.unbeat.playlist.favorite.dto.FavoriteResponse
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.time.format.DateTimeFormatter

@Service
class FavoriteService(private val favoriteRepository: FavoriteRepository) {

	fun list(sessionId: String): List<FavoriteResponse> =
		favoriteRepository.findBySessionIdOrderByCreatedAtDesc(sessionId).map { it.toResponse() }

	// 이미 즐겨찾기 되어있으면 그대로 반환 (멱등하게 처리 -> 프론트에서 중복 클릭 걱정 없이 호출 가능).
	// 단, 이 existing==null 체크와 save() 사이에는 틈이 있어서 거의 동시에 두 번 호출되면(더블클릭 등)
	// 둘 다 체크를 통과한 뒤 DB unique 제약(session_id, artist_name)에서 두 번째 insert가 막히는
	// race condition이 있었음(§78에서 favorite_tracks 쪽에서 실제로 겪고 발견) — 같은 패턴이라 동일하게
	// 방어: 그 예외를 그냥 500으로 터뜨리는 대신 이미 저장된 레코드를 재조회해서 정상 응답으로 돌려줌
	fun add(sessionId: String, request: FavoriteRequest): FavoriteResponse {
		val existing = favoriteRepository.findBySessionIdAndArtistName(sessionId, request.artistName)
		if (existing != null) {
			return existing.toResponse()
		}
		return try {
			favoriteRepository.save(
				Favorite(
					sessionId = sessionId,
					artistName = request.artistName,
					imageUrl = request.imageUrl
				)
			).toResponse()
		} catch (e: DataIntegrityViolationException) {
			favoriteRepository.findBySessionIdAndArtistName(sessionId, request.artistName)?.toResponse()
				?: throw e
		}
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
