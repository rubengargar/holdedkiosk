interface Env {
	// Si tienes bindings de KV, D1, etc., defínelos aquí
}

// Helper para añadir cabeceras CORS
const corsHeaders = {
	'Access-Control-Allow-Origin': '*', // O tu dominio de frontend específico para producción
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, X-Holded-API-Key', // Asegúrate de incluir X-Holded-API-Key
};

async function handleOptions(request: Request) {
	// Asegúrate de que la solicitud OPTIONS tenga las cabeceras correctas
	if (
		request.headers.get('Origin') !== null &&
		request.headers.get('Access-Control-Request-Method') !== null &&
		request.headers.get('Access-Control-Request-Headers') !== null
	) {
		// Manejar la solicitud preflight
		return new Response(null, {
			headers: corsHeaders,
			status: 200, // Es crucial que sea 200 OK para OPTIONS
		});
	} else {
		// Manejar OPTIONS sin las cabeceras CORS necesarias
		return new Response(null, {
			headers: {
				Allow: 'GET, POST, OPTIONS',
			},
			status: 204, // No Content
		});
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Manejar solicitudes OPTIONS primero
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}

		const holdedApiKey = request.headers.get('X-Holded-API-Key');

		if (!holdedApiKey) {
			return new Response(JSON.stringify({ error: 'No token provided' }), {
				status: 401,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Ruta para obtener todos los empleados
		if (url.pathname === '/api/employees' && request.method === 'GET') {
			try {
				let allEmployees: any[] = [];
				let page = 1;
				const perPage = 50; // Máximo permitido por Holded
				let moreEmployeesExist = true;

				while (moreEmployeesExist) {
					// Usando el endpoint sugerido por el usuario para listar empleados
					const response = await fetch(`https://api.holded.com/api/team/v1/employees?page=${page}&perPage=${perPage}`, {
						method: 'GET',
						headers: {
							'key': holdedApiKey,
							'Content-Type': 'application/json',
						},
					});

					if (!response.ok) {
						const errorData = await response.text();
						console.error('Holded API error (fetching employees):', response.status, errorData);
						return new Response(JSON.stringify({ error: 'Failed to fetch employees from Holded', details: errorData }), {
							status: response.status,
							headers: { ...corsHeaders, 'Content-Type': 'application/json' },
						});
					}

					const data: any = await response.json();
					// La API de Holded devuelve un objeto con una clave "employees" que contiene el array
					if (data && Array.isArray(data.employees)) { 
						allEmployees = allEmployees.concat(data.employees);
						if (data.employees.length < perPage) {
							moreEmployeesExist = false;
						} else {
							page++;
						}
					} else {
						// Si la respuesta no tiene la estructura esperada
						console.error('Holded API unexpected response format (fetching employees): Expected data.employees to be an array. Received:', data);
						return new Response(JSON.stringify({ error: 'Unexpected response format from Holded API when fetching employees' }), {
							status: 500, 
							headers: { ...corsHeaders, 'Content-Type': 'application/json' },
						});
					}
				}
				return new Response(JSON.stringify(allEmployees), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			} catch (error: any) {
				console.error('Error fetching employees:', error);
				return new Response(JSON.stringify({ error: 'Internal server error while fetching employees', details: error.message }), {
					status: 500,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
		}

		// Ruta para fichar ENTRADA (clock-in)
		const clockInMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/clockin$/);
		if (clockInMatch && request.method === 'POST') {
			const employeeId = clockInMatch[1];
			try {
				const holdedResponse = await fetch(`https://api.holded.com/api/team/v1/employees/${employeeId}/times/clockin`, {
					method: 'POST',
					headers: {
						'key': holdedApiKey,
						'Content-Type': 'application/json',
					},
					// El endpoint de clockin de Holded generalmente no requiere cuerpo o uno vacío.
					// body: JSON.stringify({}), // Descomentar si Holded requiere un cuerpo vacío.
				});

				if (!holdedResponse.ok) {
					const errorData = await holdedResponse.text();
					console.error('Holded API error (clock-in):', holdedResponse.status, errorData);
					return new Response(JSON.stringify({ error: 'Failed to clock in', details: errorData }), {
						status: holdedResponse.status,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' },
					});
				}

				const responseData = await holdedResponse.json();
				return new Response(JSON.stringify(responseData), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			} catch (error: any) {
				console.error('Error during clock-in action:', error);
				return new Response(JSON.stringify({ error: 'Internal server error during clock-in action', details: error.message }), {
					status: 500,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
		}

		// Ruta para fichar SALIDA (clock-out)
		const clockOutMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/clockout$/);
		if (clockOutMatch && request.method === 'POST') {
			const employeeId = clockOutMatch[1];
			try {
				const holdedResponse = await fetch(`https://api.holded.com/api/team/v1/employees/${employeeId}/times/clockout`, {
					method: 'POST',
					headers: {
						'key': holdedApiKey,
						'Content-Type': 'application/json',
					},
					// El endpoint de clockout de Holded generalmente no requiere cuerpo o uno vacío.
					// body: JSON.stringify({}), // Descomentar si Holded requiere un cuerpo vacío.
				});

				if (!holdedResponse.ok) {
					const errorData = await holdedResponse.text();
					console.error('Holded API error (clock-out):', holdedResponse.status, errorData);
					return new Response(JSON.stringify({ error: 'Failed to clock out', details: errorData }), {
						status: holdedResponse.status,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' },
					});
				}

				const responseData = await holdedResponse.json();
				return new Response(JSON.stringify(responseData), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			} catch (error: any) {
				console.error('Error during clock-out action:', error);
				return new Response(JSON.stringify({ error: 'Internal server error during clock-out action', details: error.message }), {
					status: 500,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
		}
		
		// Ruta para obtener los fichajes de un empleado
		const timesMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/times$/);
		if (timesMatch && request.method === 'GET') {
			const employeeId = timesMatch[1];
			try {
				// Usando el endpoint corregido según la documentación
				const holdedResponse = await fetch(`https://api.holded.com/api/team/v1/employees/${employeeId}/times`, {
					method: 'GET',
					headers: {
						'key': holdedApiKey,
						'Content-Type': 'application/json',
					},
				});

				if (!holdedResponse.ok) {
					const errorData = await holdedResponse.text();
					console.error('Holded API error (fetching employee times):', holdedResponse.status, errorData);
					return new Response(JSON.stringify({ error: 'Failed to fetch employee times', details: errorData }), {
						status: holdedResponse.status,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' },
					});
				}
				const responseData = await holdedResponse.json();
				return new Response(JSON.stringify(responseData), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});

			} catch (error: any) {
				console.error('Error fetching employee times:', error);
				return new Response(JSON.stringify({ error: 'Internal server error fetching employee times', details: error.message }), {
					status: 500,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
		}

		// Si ninguna ruta coincide, eliminar el antiguo endpoint genérico de /clock
		// const clockMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/clock$/);
		// if (clockMatch && request.method === 'POST') { ... } // ESTE BLOQUE SE ELIMINA

		return new Response('Not Found', { status: 404, headers: corsHeaders });
	},
};
