package com.unbeat.playlist.profile

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

class UserProfileServiceTest {

    private val userProfileRepository: UserProfileRepository = mock()
    private val service = UserProfileService(userProfileRepository)

    @Test
    fun `처음 닉네임을 정하면 새로 저장된다`() {
        whenever(userProfileRepository.findByNickname("정연")).thenReturn(null)
        whenever(userProfileRepository.findByUserId("user-1")).thenReturn(null)

        val result = service.setNickname("user-1", "정연")

        assertTrue(result is SetNicknameResult.Success)
        assertEquals("정연", (result as SetNicknameResult.Success).nickname)
        verify(userProfileRepository).save(any())
    }

    @Test
    fun `이미 다른 사람이 쓰는 닉네임이면 거부한다`() {
        whenever(userProfileRepository.findByNickname("정연"))
            .thenReturn(UserProfile(userId = "someone-else", nickname = "정연"))

        val result = service.setNickname("user-1", "정연")

        assertTrue(result is SetNicknameResult.Duplicate)
    }

    @Test
    fun `자기 자신의 현재 닉네임으로는 다시 저장해도 거부되지 않는다`() {
        val existing = UserProfile(userId = "user-1", nickname = "정연")
        whenever(userProfileRepository.findByNickname("정연")).thenReturn(existing)
        whenever(userProfileRepository.findByUserId("user-1")).thenReturn(existing)

        val result = service.setNickname("user-1", "정연")

        assertTrue(result is SetNicknameResult.Success)
    }

    @Test
    fun `너무 짧은 닉네임은 거부한다`() {
        val result = service.setNickname("user-1", "a")

        assertTrue(result is SetNicknameResult.Invalid)
    }
}
