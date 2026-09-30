package com.unbeat.playlist.health

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Render의 healthCheckPath 전용 초경량 엔드포인트.
 *
 * /actuator/health는 기본적으로 DB 상태까지 확인하는데, DB 연결이 간헐적으로 불안정한
 * 상황에서 헬스체크가 계속 응답을 못 받고 멈춰서(hang) 배포 자체가 "Timed Out"으로
 * 실패하는 문제가 있었음 (management.health.db.enabled=false로도 해결이 안 됨).
 *
 * DB/JPA/Hikari 등 어떤 의존성도 건드리지 않고, 프로세스가 살아있으면 무조건 즉시
 * 200을 반환하도록 만들어서 배포 통과 여부를 DB 상태와 완전히 분리함.
 */
@RestController
class HealthController {
    @GetMapping("/healthz")
    fun healthz(): String = "OK"
}
