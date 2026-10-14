package com.unbeat.playlist.userplaylist

import com.unbeat.playlist.profile.UserProfile
import com.unbeat.playlist.profile.UserProfileRepository
import com.unbeat.playlist.userplaylist.dto.PlaylistRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.util.Optional

class PlaylistServiceTest {

    private val playlistRepository: PlaylistRepository = mock()
    private val playlistTrackRepository: PlaylistTrackRepository = mock()
    private val userProfileRepository: UserProfileRepository = mock()
    private val playlistLikeRepository: PlaylistLikeRepository = mock()
    private val service = PlaylistService(
        playlistRepository, playlistTrackRepository, userProfileRepository, playlistLikeRepository
    )

    @Test
    fun `이름을 비워서 만들면 기본 이름이 붙는다`() {
        val saved = Playlist(sessionId = "s1", name = "새 재생목록").apply { id = 1L }
        whenever(playlistRepository.save(any())).thenReturn(saved)
        whenever(playlistTrackRepository.countByPlaylistId(1L)).thenReturn(0L)

        val result = service.create("s1", null, PlaylistRequest(name = "   "))

        assertEquals("새 재생목록", result.name)
        assertEquals(0, result.trackCount)
    }

    @Test
    fun `비로그인 상태에서는 공개로 전환할 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val result = service.setVisibility("s1", null, 1L, true)

        assertTrue(result is VisibilityResult.LoginRequired)
        verify(playlistRepository, never()).save(any())
    }

    @Test
    fun `로그인했지만 닉네임이 없으면 공개로 전환할 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(userProfileRepository.findByUserId("user-uuid-1")).thenReturn(null)

        val result = service.setVisibility("s1", "user-uuid-1", 1L, true)

        assertTrue(result is VisibilityResult.NicknameRequired)
        verify(playlistRepository, never()).save(any())
    }

    @Test
    fun `로그인+닉네임+카테고리가 있으면 공개로 전환하면서 userId와 카테고리가 기록된다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(userProfileRepository.findByUserId("user-uuid-1"))
            .thenReturn(UserProfile(userId = "user-uuid-1", nickname = "정연"))
        whenever(playlistRepository.save(any())).thenAnswer { it.arguments[0] as Playlist }
        whenever(playlistTrackRepository.countByPlaylistId(1L)).thenReturn(0L)

        val result = service.setVisibility("s1", "user-uuid-1", 1L, true, "pop")

        assertTrue(result is VisibilityResult.Success)
        assertEquals("user-uuid-1", playlist.userId)
        assertEquals("pop", playlist.category)
        assertTrue(playlist.isPublic)
    }

    @Test
    fun `카테고리 없이는 공개로 전환할 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(userProfileRepository.findByUserId("user-uuid-1"))
            .thenReturn(UserProfile(userId = "user-uuid-1", nickname = "정연"))

        val result = service.setVisibility("s1", "user-uuid-1", 1L, true, null)

        assertTrue(result is VisibilityResult.CategoryRequired)
        verify(playlistRepository, never()).save(any())
    }

    @Test
    fun `허용되지 않은 카테고리면 공개로 전환할 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(userProfileRepository.findByUserId("user-uuid-1"))
            .thenReturn(UserProfile(userId = "user-uuid-1", nickname = "정연"))

        val result = service.setVisibility("s1", "user-uuid-1", 1L, true, "존재하지않는값")

        assertTrue(result is VisibilityResult.CategoryRequired)
    }

    @Test
    fun `공개 피드는 재생목록에 소유자 닉네임을 같이 돌려준다`() {
        val playlist = Playlist(
            sessionId = "s1", name = "팝", userId = "user-uuid-1", isPublic = true
        ).apply { id = 1L }
        whenever(playlistRepository.findByIsPublicTrueOrderByCreatedAtDesc()).thenReturn(listOf(playlist))
        whenever(playlistTrackRepository.countByPlaylistId(1L)).thenReturn(19L)
        whenever(userProfileRepository.findByUserId("user-uuid-1"))
            .thenReturn(UserProfile(userId = "user-uuid-1", nickname = "정연"))

        val result = service.listPublic()

        assertEquals(1, result.size)
        assertEquals("정연", result[0].ownerNickname)
        assertEquals(19, result[0].trackCount)
    }

    @Test
    fun `공개 피드는 이미지 있는 가장 최근 곡을 대표 커버로 돌려준다`() {
        val playlist = Playlist(
            sessionId = "s1", name = "팝", userId = "user-uuid-1", isPublic = true
        ).apply { id = 1L }
        val cover = PlaylistTrack(
            playlistId = 1L, artistName = "Rosé", trackName = "APT.", imageUrl = "https://example.com/apt.jpg"
        )
        whenever(playlistRepository.findByIsPublicTrueOrderByCreatedAtDesc()).thenReturn(listOf(playlist))
        whenever(playlistTrackRepository.countByPlaylistId(1L)).thenReturn(1L)
        whenever(playlistTrackRepository.findFirstByPlaylistIdAndImageUrlIsNotNullOrderByAddedAtDesc(1L))
            .thenReturn(cover)
        whenever(userProfileRepository.findByUserId("user-uuid-1")).thenReturn(null)

        val result = service.listPublic()

        assertEquals("https://example.com/apt.jpg", result[0].coverImageUrl)
    }

    @Test
    fun `공개 피드는 좋아요 많은 순으로 정렬된다`() {
        val less = Playlist(sessionId = "s1", name = "덜 좋아요", isPublic = true).apply { id = 1L }
        val more = Playlist(sessionId = "s2", name = "더 좋아요", isPublic = true).apply { id = 2L }
        whenever(playlistRepository.findByIsPublicTrueOrderByCreatedAtDesc()).thenReturn(listOf(less, more))
        whenever(playlistLikeRepository.countByPlaylistId(1L)).thenReturn(2L)
        whenever(playlistLikeRepository.countByPlaylistId(2L)).thenReturn(9L)

        val result = service.listPublic()

        assertEquals("더 좋아요", result[0].name)
        assertEquals(9, result[0].likeCount)
        assertEquals("덜 좋아요", result[1].name)
    }

    @Test
    fun `비로그인은 좋아요를 누를 수 없다`() {
        val result = service.like(null, 1L)

        assertTrue(result is LikeResult.LoginRequired)
        verify(playlistLikeRepository, never()).save(any())
    }

    @Test
    fun `비공개 재생목록은 좋아요 대상이 아니다`() {
        val playlist = Playlist(sessionId = "owner", name = "비공개", isPublic = false).apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val result = service.like("user-1", 1L)

        assertTrue(result is LikeResult.NotFound)
        verify(playlistLikeRepository, never()).save(any())
    }

    @Test
    fun `같은 사람이 두 번 좋아요를 눌러도 중복 저장되지 않는다`() {
        val playlist = Playlist(sessionId = "owner", name = "팝", isPublic = true).apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(playlistLikeRepository.existsByPlaylistIdAndUserId(1L, "user-1")).thenReturn(true)
        whenever(playlistLikeRepository.countByPlaylistId(1L)).thenReturn(1L)

        val result = service.like("user-1", 1L)

        assertTrue(result is LikeResult.Success)
        assertEquals(1, (result as LikeResult.Success).likeCount)
        verify(playlistLikeRepository, never()).save(any())
    }

    @Test
    fun `좋아요를 취소하면 개수가 줄어든다`() {
        val playlist = Playlist(sessionId = "owner", name = "팝", isPublic = true).apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(playlistLikeRepository.countByPlaylistId(1L)).thenReturn(0L)

        val result = service.unlike("user-1", 1L)

        assertTrue(result is LikeResult.Success)
        assertFalse((result as LikeResult.Success).likedByMe)
        verify(playlistLikeRepository).deleteByPlaylistIdAndUserId(1L, "user-1")
    }

    @Test
    fun `다른 세션의 재생목록은 공개로 전환할 수 없다`() {
        val playlist = Playlist(sessionId = "owner", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val result = service.setVisibility("stranger", "user-uuid-1", 1L, true)

        assertTrue(result is VisibilityResult.NotFound)
    }

    @Test
    fun `공개 재생목록은 소유자가 아니어도 곡 목록을 볼 수 있다`() {
        val playlist = Playlist(sessionId = "owner", name = "출퇴근길", isPublic = true).apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        whenever(playlistTrackRepository.findByPlaylistIdOrderByAddedAtDesc(1L)).thenReturn(emptyList())

        val result = service.getTracks("stranger", 1L)

        assertEquals(emptyList<Any>(), result)
    }

    @Test
    fun `비공개 재생목록은 소유자가 아니면 곡 목록을 볼 수 없다`() {
        val playlist = Playlist(sessionId = "owner", name = "출퇴근길", isPublic = false).apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val result = service.getTracks("stranger", 1L)

        assertNull(result)
    }

    @Test
    fun `다른 세션의 재생목록은 삭제할 수 없다`() {
        val playlist = Playlist(sessionId = "owner", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val removed = service.delete("stranger", 1L)

        assertFalse(removed)
        verify(playlistTrackRepository, never()).deleteByPlaylistId(any())
        verify(playlistRepository, never()).delete(any<Playlist>())
    }

    @Test
    fun `재생목록을 지우면 담긴 곡도 같이 지운다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val removed = service.delete("s1", 1L)

        assertTrue(removed)
        verify(playlistTrackRepository).deleteByPlaylistId(1L)
        verify(playlistRepository).delete(playlist)
    }

    @Test
    fun `같은 곡을 같은 재생목록에 두 번 추가하면 기존 걸 그대로 반환한다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        val existing = PlaylistTrack(playlistId = 1L, artistName = "IU", trackName = "Blueming").apply { id = 5L }
        whenever(playlistTrackRepository.findByPlaylistIdAndArtistNameAndTrackName(1L, "IU", "Blueming"))
            .thenReturn(existing)

        val result = service.addTrack("s1", 1L, PlaylistTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertEquals(5L, result?.id)
        verify(playlistTrackRepository, never()).save(any())
    }

    @Test
    fun `존재하지 않는 재생목록에는 곡을 추가할 수 없다`() {
        whenever(playlistRepository.findById(99L)).thenReturn(Optional.empty())

        val result = service.addTrack("s1", 99L, PlaylistTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertNull(result)
    }

    @Test
    fun `다른 재생목록 소속 곡은 지울 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        val trackInOtherPlaylist = PlaylistTrack(playlistId = 2L, artistName = "IU", trackName = "Blueming")
            .apply { id = 5L }
        whenever(playlistTrackRepository.findById(5L)).thenReturn(Optional.of(trackInOtherPlaylist))

        val removed = service.removeTrack("s1", 1L, 5L)

        assertFalse(removed)
        verify(playlistTrackRepository, never()).delete(any<PlaylistTrack>())
    }
}
