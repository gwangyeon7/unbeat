plugins {
	kotlin("jvm") version "2.2.20"
	kotlin("plugin.spring") version "2.2.20"
	kotlin("plugin.jpa") version "2.2.20"
	id("org.springframework.boot") version "4.1.0"
	// io.spring.dependency-management 플러그인은 뺐음 — 마지막 릴리즈(1.1.7)가 Gradle 9 나오기 전에
	// 나온 거라 Gradle 9의 내부 API 변경(LenientConfiguration)이랑 안 맞아서 동기화가 깨짐(NoSuchMethodError).
	// 대신 Gradle 기본 platform() 기능으로 Spring Boot BOM을 직접 끌어와서 같은 효과를 냄.
}

group = "com.unbeat"
version = "0.0.1-SNAPSHOT"

java {
	sourceCompatibility = JavaVersion.VERSION_17
}

repositories {
	mavenCentral()
}

dependencies {
	implementation(platform("org.springframework.boot:spring-boot-dependencies:4.1.0"))

	implementation("org.springframework.boot:spring-boot-starter-web")
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	// Render의 헬스체크(render.yaml healthCheckPath: /actuator/health)가 찌를 엔드포인트용.
	// 기본 설정만으로 /actuator/health가 웹에 노출됨(추가 코드 불필요).
	implementation("org.springframework.boot:spring-boot-starter-actuator")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	runtimeOnly("com.mysql:mysql-connector-j")
	// Supabase 로그인 JWT 검증용(게이미피케이션의 전제조건, 2026-10-10). FastAPI 쪽(backend/auth.py)은
	// PyJWKClient로 JWKS 공개키를 받아 ES256 서명을 검증하는데, 그 자바/코틀린 생태계 동급 라이브러리.
	// 전체 Spring Security를 새로 들이는 대신 이 라이브러리 하나로 "헤더 파싱 -> 서명 검증 -> sub 추출"만
	// 가볍게 처리 — 기존 컨트롤러들이 @RequestHeader로 직접 값을 받는 단순한 스타일과 일관되게 유지.
	implementation("com.nimbusds:nimbus-jose-jwt:9.37.3")

	testImplementation("org.springframework.boot:spring-boot-starter-test")
	testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.add("-Xjsr305=strict")
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}
