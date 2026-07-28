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
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	runtimeOnly("com.mysql:mysql-connector-j")

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
