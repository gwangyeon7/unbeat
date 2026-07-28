package com.unbeat.playlist.favorite

import com.unbeat.playlist.favorite.dto.FavoriteRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.mockito.Mockito.never
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.util.Optional

class FavoriteServiceTest {

	private val repository: FavoriteRepository = mock()
	private val service = FavoriteService(repository)

	@Test
	fun `이미 즐겨찾기한 아티스트는 중복 저장하지 않고 기존 걸 반환한다`() {
		val existing = Favorite(sessionId = "s1", artistName = "IU").apply { id = 1L }
		whenever(repository.findBySessionIdAndArtistName("s1", "IU")).thenReturn(existing)

		val result = service.add("s1", FavoriteRequest(artistName = "IU"))

		assertEquals(1L, result.id)
		verify(repository, never()).save(any())
	}

	@Test
	fun `처음 추가하는 아티스트는 새로 저장한다`() {
		whenever(repository.findBySessionIdAndArtistName("s1", "IU")).thenReturn(null)
		val saved = Favorite(sessionId = "s1", artistName = "IU").apply { id = 5L }
		whenever(repository.save(any())).thenReturn(saved)

		val result = service.add("s1", FavoriteRequest(artistName = "IU"))

		assertEquals(5L, result.id)
	}

	@Test
	fun `다른 세션의 즐겨찾기는 삭제할 수 없다`() {
		val favorite = Favorite(sessionId = "owner", artistName = "IU").apply { id = 1L }
		whenever(repository.findById(1L)).thenReturn(Optional.of(favorite))

		val removed = service.remove("stranger", 1L)

		assertFalse(removed)
		verify(repository, never()).delete(any<Favorite>())
	}
}
