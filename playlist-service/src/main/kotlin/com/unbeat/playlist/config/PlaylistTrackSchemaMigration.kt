package com.unbeat.playlist.config

import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

/**
 * (2026-11-19) "그래도 추가"로 같은 곡을 한 번 더 담을 수 있게 playlist_tracks의 UNIQUE를
 * (playlist_id, artist_name, track_name) -> (playlist_id, artist_name, track_name, dup_index)로 바꿈.
 * `ddl-auto: update`는 컬럼/인덱스를 새로 만들 수만 있고 옛 인덱스를 지우지 못해서, 서버가 켜질 때 한 번 직접 정리함 —
 * 로컬/운영 DB를 손으로 고치지 않아도 배포만으로 적용됨. 이미 적용돼 있으면 아무것도 안 하고(멱등), 실패해도 서버는 계속 뜸
 * (그 경우 "그래도 추가"만 실패하고 나머지 기능은 그대로).
 */
@Component
class PlaylistTrackSchemaMigration(private val jdbc: JdbcTemplate) : ApplicationRunner {

    override fun run(args: ApplicationArguments) {
        try {
            // 컬럼이 아직 없으면(ddl-auto가 아직 못 만든 경우) 건너뜀 — 다음 기동 때 적용
            val hasDupColumn = jdbc.queryForList(
                "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() " +
                    "AND table_name = 'playlist_tracks' AND column_name = 'dup_index'"
            ).isNotEmpty()
            if (!hasDupColumn) return

            // 유니크 인덱스별 컬럼 구성
            val rows = jdbc.queryForList(
                "SELECT index_name AS name, CAST(GROUP_CONCAT(column_name ORDER BY seq_in_index) AS CHAR) AS cols " +
                    "FROM information_schema.statistics WHERE table_schema = DATABASE() " +
                    "AND table_name = 'playlist_tracks' AND non_unique = 0 GROUP BY index_name"
            )
            val unique = rows.associate { it["name"].toString() to it["cols"].toString() }
            val newCols = "playlist_id,artist_name,track_name,dup_index"
            val oldCols = "playlist_id,artist_name,track_name"

            if (newCols !in unique.values) {
                jdbc.execute(
                    "CREATE UNIQUE INDEX uk_playlist_tracks_dup ON playlist_tracks " +
                        "(playlist_id, artist_name, track_name, dup_index)"
                )
                println("[migration] playlist_tracks 새 UNIQUE(uk_playlist_tracks_dup) 생성")
            }
            unique.filterValues { it == oldCols }.keys.forEach { name ->
                jdbc.execute("ALTER TABLE playlist_tracks DROP INDEX `$name`")
                println("[migration] playlist_tracks 옛 UNIQUE($name) 삭제")
            }
        } catch (e: Exception) {
            println("[migration] playlist_tracks UNIQUE 정리 실패(무시하고 진행): ${e.message}")
        }
    }
}
